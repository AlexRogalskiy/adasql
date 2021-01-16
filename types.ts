import {
  RegionInputConfig
} from '@aws-sdk/config-resolver';

import {
  AwsAuthInputConfig
} from '@aws-sdk/middleware-signing';

export type AWSConfig = RegionInputConfig & AwsAuthInputConfig

export interface AWSInfo {
  partition: string,
  accountId: string,
  region: string,
  userArn: string,
  accountAlias?: string
}

export type ColumnValue = string | number | boolean | Uint8Array | Date | null | undefined;

export interface Row {
  [key: string]: ColumnValue
}

export interface Keywords {
  mysqlKeywords: Set<string>,
  schemaNames: Set<string>,
  objectNames: Set<string>,
  objectDotNames: Set<string>
}