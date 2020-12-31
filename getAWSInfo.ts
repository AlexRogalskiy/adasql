import {
  STSClient,
  GetCallerIdentityCommand
} from '@aws-sdk/client-sts';

import {
  IAMClient,
  ListAccountAliasesCommand
} from '@aws-sdk/client-iam';

import {
  AWSConfig,
  AWSInfo
} from './types';

export default async function getAWSInfo(awsConfig: AWSConfig): Promise<AWSInfo> {
  const stsClient = new STSClient(awsConfig);

  const { Account: accountId, Arn: userArn } = await stsClient.send(
    new GetCallerIdentityCommand({})
  );

  const iamClient = new IAMClient(awsConfig);

  const { AccountAliases: aliases } = await iamClient.send(
    new ListAccountAliasesCommand({})
  );

  return {
    accountId: accountId as string,
    partition: (userArn as string).split(':')[1],
    userArn: userArn as string,
    region: await stsClient.config.region(),
    accountAlias: aliases ? aliases[0] : undefined
  }
}