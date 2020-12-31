# [AWS Aurora Data API](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/data-api.html) SQL client

This Node.js package provides a CLI client to connect and query AWS Aurora Database Clusters using the Data API. It mimics the mysql and psql CLI clients.

## Usage

First, create an Aurora Serverless Database ([here's a blog post with an example](https://aws.amazon.com/blogs/aws/new-data-api-for-amazon-aurora-serverless/)).

Next install this package:

```bash
$ npm install --global adasql
```

Now run the command:
```bash
$ adasql -d testdb
Using AWS Credentials: From local environment
Using AWS Region: From local environment
AWS Account: 012345678901
AWS Region: us-west-2
AWS User: assumed-role/alice@example.com/cli
AWS Account Alias: (none)
Found only one Aurora Data API-enabled Database Cluster: mystack-mydb-s98d7f8d7f
Found only one secret in AWS Secrets Manager: /mystack/mydb/user-secret
Connecting with the following configuration: 
  RDS Aurora Cluster ID:       mystack-mydb-s98d7f8d7f
  Secrets Manager Secret Name: /mystack/mydb/user-secret
  Database:                    testdb
> SELECT * FROM feature_flags;
Records: 
  - 
    id:              1
    feature_name:    myAwesomeNewFeature
Record Count: 1
```

adasql will show you information up top to help you ensure you're connecting to the right DB. It will then look for AWS Aurora Database Clusters with the Data API enabled. If it finds only one database cluster it will use it, otherwise it will prompt you for the database to connect to. It will then look for AWS Secrets Manager Secrets to use for authentication when connecting. Again, if it finds only one secret it will use it, otherwise it will prompt you for the secret to use.

Transactions are supported, though note the Data API doesn't support save points or nested transactions.