import {
  ExecuteStatementCommand,
  Field,
  RDSDataClient
} from "@aws-sdk/client-rds-data";

import { Keywords } from './types';

import mysqlKeywords from './mysqlKeywords';

export default async function fetchKeywords(rdsDataClient: RDSDataClient, resourceArn: string, secretArn: string, database?: string): Promise<Keywords> {
  let records;

  try {
    ({ records } = await rdsDataClient.send(
      new ExecuteStatementCommand({
        resourceArn,
        secretArn,
        sql: 'show schemas'
      })
    ));
  } catch (err) {
    console.warn(`Warning: Failed to query for schemas, autocomplete will be limited (${err.message})`);
  }

  let schemaNames: Set<string>;

  if (records) {
    schemaNames = new Set(records.map(record => record[0].stringValue as string));
  } else {
    schemaNames = new Set();
  }

  let objectNames: Set<string>;
  const objectDotNames: Set<string> = new Set();

  if (database) {
    try {
      ({ records } = await rdsDataClient.send(
        new ExecuteStatementCommand({
          resourceArn,
          secretArn,
          sql: 'show tables',
          database
        })
      ));
    } catch (err) {
      console.warn(`Warning: Failed to query for tables, autocomplete will be limited (${err.message})`);
    }

    let tableNames: Set<string>;
    if (records) {
      tableNames = new Set(records.map(record => record[0].stringValue as string));
      objectNames = new Set(tableNames);
    } else {
      tableNames = new Set();
      objectNames = new Set();
    }

    for (const tableName of tableNames) {
      let records: Field[][] | undefined;
      try {
        ({ records } = await rdsDataClient.send(
          new ExecuteStatementCommand({
            resourceArn,
            secretArn,
            sql: `show columns from \`${tableName.replace(/`/g, '``')}\``,
            database
          })
        ));
      } catch (err) {
        console.warn(`Warning: Failed to query for columns from table '${tableName}', autocomplete will be limited (${err.message})`);
      }

      if (records) {
        const columnNames = records.map(record => record[0].stringValue as string);

        for (const columnName of columnNames) {
          objectNames.add(columnName);
          objectDotNames.add(`${tableName}.${columnName}`);
        }
      }
    }
  } else {
    objectNames = new Set();
  }

  return {
    mysqlKeywords,
    schemaNames,
    objectNames,
    objectDotNames
  };
}