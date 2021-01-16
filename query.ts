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

import hydrateRecords from './hydrateRecords';
import fetchKeywords from './fetchKeywords';

const DB_SELECT_COMMAND_RE = /^(?:use|\\c(?:onnect)?)\s+([^;\s]+);?$/i;
const TX_BEGIN_COMMAND_RE = /^begin;$/i
const TX_ROLLBACK_COMMAND_RE = /^rollback;$/i
const TX_COMMIT_COMMAND_RE = /^commit;$/i

let keywords: Promise<Keywords>;

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

  let transactionId: string | undefined;

  replStart({
    eval: async function (this: REPLServer, command: string, context: Context, file: string, cb: (err: Error | null, result: string | Record<string, unknown>) => void) {
      command = command.trim();

      const dbMatch = command.match(DB_SELECT_COMMAND_RE);
      if (dbMatch) {
        database = dbMatch[1];
        keywords = fetchKeywords(rdsDataClient, resourceArn, secretArn, database);
        cb(null, `Now using database ${database}`);
        return;
      }

      if (TX_BEGIN_COMMAND_RE.test(command)) {
        if (transactionId) {
          cb(null, `Error: Transaction '${transactionId}' currently in progress, cannot create a new one`);
          return;
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
          cb(null, `Failed to begin transaction: ${err.message} (${err.code})`);
        }

        return;
      }

      if (TX_ROLLBACK_COMMAND_RE.test(command)) {
        if (!transactionId) {
          cb(null, `Error: No transaction currently in progress`);
          return;
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
          cb(null, `Failed to rollback transaction '${transactionId}': ${err.message} (${err.code})`);
        }

        return;
      }

      if (TX_COMMIT_COMMAND_RE.test(command)) {
        if (!transactionId) {
          cb(null, `Error: No transaction currently in progress`);
          return;
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
          cb(null, `Failed to commit transaction '${transactionId}': ${err.message} (${err.code})`);
        }

        return;
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
        cb(null, `Failed to execute statement: ${err.message} (${err.code})`);
        return;
      }

      const output: {
        Records?: Row[]
        'Record Count'?: number
        'Number of Affected Records'?: number
      } = {};

      if (records) {
        output.Records = hydrateRecords(records, columnMetadata as ColumnMetadata[]);
        output['Record Count'] = output.Records.length
      } else if (typeof numberOfRecordsUpdated === 'number') {
        output['Number of Affected Records'] = numberOfRecordsUpdated
      }

      cb(null, output);
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

        let token = line.split(/\s+/).pop() as string;
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
    writer: prettyoutput
  });
}