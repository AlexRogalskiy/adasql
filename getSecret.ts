import {
  SecretsManagerClient,
  paginateListSecrets
} from '@aws-sdk/client-secrets-manager';

import inquirer from 'inquirer';
import prettyoutput from 'prettyoutput';

import {
  AWSConfig
} from './types';

export default async function getSecret(awsConfig: AWSConfig): Promise<string> {
  const secretsClient = new SecretsManagerClient(awsConfig);

  const paginator = paginateListSecrets({ client: secretsClient }, {});

  const secretNames: string[] = [];
  for await (const { SecretList: secrets } of paginator) {
    if (secrets) {
      secretNames.push(...secrets.map(secret => secret.Name as string));
    }
  }

  if (secretNames.length === 0) {
    console.error('No secrets found in AWS Secrets Manager');
    process.exit(1);
  }

  if (secretNames.length === 1) {
    console.log(prettyoutput({ 'Found only one secret in AWS Secrets Manager': secretNames[0] }).trim());
    return secretNames[0];
  }

  const prompt = inquirer.createPromptModule();

  const { secretName } = await prompt([
    {
      type: 'list',
      name: 'secretName',
      message: 'Which secret?',
      choices: secretNames
    }
  ]);

  return secretName;
}