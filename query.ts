import {
  start as replStart,
  REPLServer
} from 'repl';

import {
  Context
} from 'vm';

import {
  RDSDataClient,
  ExecuteStatementCommand,
  BeginTransactionCommand,
  RollbackTransactionCommand,
  CommitTransactionCommand,
  ColumnMetadata,
  Field
} from '@aws-sdk/client-rds-data';

import prettyoutput from 'prettyoutput';

import {
  CompleterResult
} from 'readline';

import {
  AWSConfig,
  AWSInfo,
  Row,
  Keywords
} from './types';

type REPLCallback = (err: Error | null, result?: string | Record<string, unknown>) => void

interface Statement {
  command: string,
  cb: REPLCallback
}

import hydrateRecords from './hydrateRecords';
import fetchKeywords from './fetchKeywords';

const DB_SELECT_COMMAND_RE = /^\s*(?:use|\\c(?:onnect)?)\s+(`?)([^;\s]+)\1;?\s*$/i;
const TX_BEGIN_COMMAND_RE = /^\s*begin\s*;$/i
const TX_ROLLBACK_COMMAND_RE = /^\s*rollback\s*;$/i
const TX_COMMIT_COMMAND_RE = /^\s*commit\s*;$/i
const COMMENT_BEGIN_RE = /\/\*(?!!)/;
const COMMENT_END_RE = /\*\//;
const IN_COMMENT_END_RE = /(.|\n|\r)*?\*\//m;
const START_COMMENT_RE = /\/\*(?!!)(.|\n|\r)*/m;
const FULL_COMMENT_RE = /\/\*(?!!)(.|\n|\r)*?\*\//mg;

// Comments that start like like /*! or /*!57384 contain statements that *should* be executed by MySQL clients. See https://dev.mysql.com/doc/refman/en/comments.html.
const FULL_NON_MYSQL_COMMENT_RE = /\/\*!\d*((?:.|\n|\r)*?)\*\//mg;

let keywords: Promise<Keywords>;

let currentStatementPromiseResolver: (value: Statement) => void;
const statementPromises: Promise<Statement>[] = [
  new Promise(resolve => currentStatementPromiseResolver = resolve)
];

export default async function query(awsConfig: AWSConfig, awsInfo: AWSInfo, clusterId: string, secretName: string, database?: string): Promise<void> {
  const resourceArn = `arn:${awsInfo.partition}:rds:${awsInfo.region}:${awsInfo.accountId}:cluster:${clusterId}`;
  const secretArn = `arn:${awsInfo.partition}:secretsmanager:${awsInfo.region}:${awsInfo.accountId}:secret:${secretName}`;

  const rdsDataClient = new RDSDataClient(awsConfig);

  try {
    await rdsDataClient.send(
      new ExecuteStatementCommand({
        resourceArn,
        secretArn,
        sql: 'SELECT 1;'
      })
    )
  } catch (err) {
    console.error(`Failed to execute test statement ('SELECT 1;') against the database: ${err.message} (${err.code})`);
    process.exit(1);
  }

  keywords = fetchKeywords(rdsDataClient, resourceArn, secretArn, database);

  // Start function to process statements sequentially
  processStatements(rdsDataClient, resourceArn, secretArn, database);

  let partial = '';
  let partialInComment = false;

  const replServer = replStart({
    eval: function (this: REPLServer, command: string, context: Context, file: string, cb: REPLCallback) {
      partial += command;

      if (partialInComment && COMMENT_END_RE.test(partial)) {
        partial.replace(IN_COMMENT_END_RE, '');
        partialInComment = false;
      }

      partial = partial
        .replace(FULL_COMMENT_RE, '')
        .replace(FULL_NON_MYSQL_COMMENT_RE, '$1');

      if (!partialInComment && COMMENT_BEGIN_RE.test(partial)) {
        partial.replace(START_COMMENT_RE, '');
        partialInComment = true;
      }

      const statements = partial.split(';');

      partial = statements.pop() as string;

      // `use <database>` is a command and doesn't require a semicolon terminator, check for it specially
      if (DB_SELECT_COMMAND_RE.test(partial)) {
        statements.push(partial);
        partial = '';
      }

      for (const statement of statements) {
        // Enqueue command to run statements sequentially
        const resolver = currentStatementPromiseResolver;
        statementPromises.push(new Promise(resolve => currentStatementPromiseResolver = resolve));
        resolver({
          command: statement,
          cb
        });
      }
    },

    // Loosely based on the mysql CLI completion algorithm
    completer: async function(line: string, callback: (err?: null | Error, result?: CompleterResult) => void) {
      try {
        if (line === '' || line[0] === '\\') {
          callback(null, [
            [],
            line
          ]);
        }

        const tokens = line.split(/\s+/);
        let token = tokens.pop() as string;
        const quoted = token[0] === '`';
        const dbNamesOnly = token.includes('.') || quoted;
        if (quoted) {
          token = token.substr(1);
        }

        const currentKeywords = await keywords;

        const complete = (keywords: Set<string>) => Array.from(keywords)
          .filter(keyword => keyword.startsWith(token))
          .map(keyword => line + keyword.substr(token.length) + (quoted ? '`' : ''));

        const completions = complete(currentKeywords.schemaNames).concat(complete(currentKeywords.objectNames));

        if (tokens.length === 0 || (tokens.length === 1 && tokens[0] === '')) {
          Array.prototype.push.apply(completions, complete(currentKeywords.replKeywords));
        }

        if (!dbNamesOnly) {
          Array.prototype.push.apply(completions, complete(currentKeywords.mysqlKeywords));
        }

        if (token.includes('.')) {
          Array.prototype.push.apply(completions, complete(currentKeywords.objectDotNames));
        }

        callback(null, [
          completions.sort(),
          line
        ]);
      } catch (err) {
        callback(err);
      }
    },
    writer: prettyoutput,
    preview: true
  });

  replServer.on('reset', () => {
    partial = '';
    partialInComment = false;
  });
}

function handleError (cb: REPLCallback, message: string) {
  if (process.stdin.isTTY) {
    cb(null, message);
  } else {
    console.error(message);
    process.exit(1);
  }
}

async function processStatements (rdsDataClient: RDSDataClient, resourceArn: string, secretArn: string, database?: string) {
  let transactionId: string | undefined;

  for await (const { command, cb } of statementPromises) {
    if (/^\s*$/.test(command)) {
      cb(null);
      continue;
    }

    const dbMatch = command.match(DB_SELECT_COMMAND_RE);
    if (dbMatch) {
      database = dbMatch[2];
      keywords = fetchKeywords(rdsDataClient, resourceArn, secretArn, database);
      cb(null, `Now using database ${database}`);
      continue;
    }

    if (TX_BEGIN_COMMAND_RE.test(command)) {
      if (transactionId) {
        handleError(cb, `Error: Transaction '${transactionId}' currently in progress, cannot create a new one`);
        continue;
      }

      try {
        ({ transactionId } = await rdsDataClient.send(
          new BeginTransactionCommand({
            resourceArn,
            secretArn,
            database
          })
        ));
        cb(null, `Transaction '${transactionId}' begun`);
      } catch (err) {
        handleError(cb, `Failed to begin transaction: ${err.message} (${err.code})`);
      }

      continue;
    }

    if (TX_ROLLBACK_COMMAND_RE.test(command)) {
      if (!transactionId) {
        cb(null, `Error: No transaction currently in progress`);
        continue;
      }

      try {
        await rdsDataClient.send(
          new RollbackTransactionCommand({
            resourceArn,
            secretArn,
            transactionId
          })
        );
        cb(null, `Transaction '${transactionId}' rolled back`);
        transactionId = undefined;
      } catch (err) {
        handleError(cb, `Failed to rollback transaction '${transactionId}': ${err.message} (${err.code})`);
      }

      continue;
    }

    if (TX_COMMIT_COMMAND_RE.test(command)) {
      if (!transactionId) {
        handleError(cb, `Error: No transaction currently in progress`);
        continue;
      }

      try {
        await rdsDataClient.send(
          new CommitTransactionCommand({
            resourceArn,
            secretArn,
            transactionId
          })
        );
        cb(null, `Transaction '${transactionId}' committed`);
        transactionId = undefined;
      } catch (err) {
        handleError(cb, `Failed to commit transaction '${transactionId}': ${err.message} (${err.code})`);
      }

      continue;
    }

    let records: Field[][] | undefined;
    let columnMetadata: ColumnMetadata[] | undefined;
    let numberOfRecordsUpdated;
    try {
      ({ records, columnMetadata, numberOfRecordsUpdated } = await rdsDataClient.send(
        new ExecuteStatementCommand({
          resourceArn,
          secretArn,
          database,
          sql: command,
          includeResultMetadata: true,
          transactionId
        })
      ));
    } catch (err) {
      handleError(cb, `Failed to execute statement: ${err.message} (${err.code})`);
      continue;
    }

    const output: {
      Records?: Row[]
      'Record Count'?: number
      'Statement': string
      'Number of Affected Records'?: number
    } = {
      Statement: command
    };

    if (records) {
      output.Records = hydrateRecords(records, columnMetadata as ColumnMetadata[]);
      output['Record Count'] = output.Records.length
    } else if (typeof numberOfRecordsUpdated === 'number') {
      output['Number of Affected Records'] = numberOfRecordsUpdated
    }

    cb(null, output);
  }
}