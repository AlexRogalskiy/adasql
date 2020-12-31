import {
  RDSClient,
  paginateDescribeDBClusters
} from '@aws-sdk/client-rds';

import inquirer from 'inquirer';
import prettyoutput from 'prettyoutput';

import {
  AWSConfig
} from './types';

export default async function getDatabaseCluster(awsConfig: AWSConfig): Promise<string> {
  const rdsClient = new RDSClient(awsConfig);

  const paginator = paginateDescribeDBClusters({ client: rdsClient }, {});

  const clusterIds: string[] = [];
  for await (const { DBClusters: clusters } of paginator) {
    if (clusters) {
      const dataApiClusterIds = clusters
        .filter(cluster => cluster.HttpEndpointEnabled)
        .map(cluster => cluster.DBClusterIdentifier as string);

      clusterIds.push(...dataApiClusterIds);
    }
  }

  if (clusterIds.length === 0) {
    console.error('No Aurora Data API-enabled Database Clusters found');
    process.exit(1);
  }

  if (clusterIds.length === 1) {
    console.log(prettyoutput({ 'Found only one Aurora Data API-enabled Database Cluster': clusterIds[0] }).trim());
    return clusterIds[0];
  }

  const prompt = inquirer.createPromptModule();

  const { clusterId } = await prompt([
    {
      type: 'list',
      name: 'clusterId',
      message: 'Which Aurora Data API-enabled Database Cluster?',
      choices: clusterIds
    }
  ]);

  return clusterId;
}