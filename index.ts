#!/usr/bin/env node

import {
  fromIni
} from '@aws-sdk/credential-provider-ini';

import prettyoutput from 'prettyoutput';
import yargs from 'yargs';

import {
  AWSConfig
} from './types';

import getAWSInfo from './getAWSInfo';
import getDatabaseCluster from './getDatabaseCluster';
import getSecret from './getSecret';
import query from './query';

const {
  cluster,
  profile,
  region,
  secret,
  database
} = yargs
  .scriptName('adasql')
  .option('cluster', {
    alias: 'c',
    type: 'string',
    describe: 'Aurora Database Cluster ID (if omitted, will query for DBs and connect to only one available or error)'
  })
  .option('profile', {
    alias: 'p',
    type: 'string',
    describe: 'AWS profile'
  })
  .option('region', {
    alias: 'r',
    type: 'string',
    describe: 'AWS region'
  })
  .option('secret', {
    alias: 's',
    type: 'string',
    describe: 'AWS Secrets Manager Secret Name (if omitted, will query for first Secret attached to the DB)'
  })
  .option('database', {
    alias: 'd',
    type: 'string',
    describe: 'Initial database to use'
  })
  .env('ADASQL')
  .argv;

(async function main() {
  const awsConfig: AWSConfig = {};

  if (profile) {
    console.log(prettyoutput({ 'Using AWS Profile': profile }).trim());
    awsConfig.credentials = fromIni({ profile });
  } else {
    console.log(prettyoutput({ 'Using AWS Credentials': 'From local environment' }).trim());
  }

  if (region) {
    console.log(prettyoutput({ 'Using AWS Region': region }).trim());
    awsConfig.region = region;
  } else {
    console.log(prettyoutput({ 'Using AWS Region': 'From local environment'}).trim());
  }

  const awsInfo = await getAWSInfo(awsConfig);

  console.log(prettyoutput({ 'AWS Account': awsInfo.accountId }).trim());
  console.log(prettyoutput({ 'AWS Region': awsInfo.region }).trim());
  console.log(prettyoutput({ 'AWS User': awsInfo.userArn.replace(/^.*:/, '') }).trim());
  console.log(prettyoutput({ 'AWS Account Alias': awsInfo.accountAlias ? awsInfo.accountAlias : '(none)' }).trim());

  const clusterId = cluster || await getDatabaseCluster(awsConfig);

  const secretName = secret ? secret : await getSecret(awsConfig);

  console.log(prettyoutput({
    'Connecting with the following configuration': {
      'RDS Aurora Cluster ID': clusterId,
      'Secrets Manager Secret Name': secretName,
      Database: database || '(none)'
    }
  }).trim());

  await query(awsConfig, awsInfo, clusterId, secretName, database);
})();