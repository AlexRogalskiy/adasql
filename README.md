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

### Multiple statements and multi-line statements
SQL statements are executed sequentially, and multiple statements can be executed when separated with the ';' delimiter. For example, the following query when executed will insert a new record and then return the same record as the first statement executes to completion before the second statement is executed:

```SQL
INSERT INTO people (id, name, age) VALUES (1, 'Alice', 39); SELECT * from mytable WHERE id = 1;
```

#### Canceling commands
If you find yourself in the middle of a multi-line statement and wish to cancel it, enter `.clear`. This will reset the state of the REPL, though it will not affect a transaction if it is in progress.

## FAQ
### Can adasql be used for migrations, seeding data, or restoring backups?
Maybe! But for most use cases adasql will not work. The Aurora Data API has three issues that make migrations and restoring backups difficult:

* SQL connections to the DB used by the Data API are multiplexed, and there is no way to ensure affinity for statements that set per-connection variables. This is important when restoring backups where the backups need to execute commands like `SET FOREIGN_KEY_CHECKS=0` to disable foreign key checks when inserting records using the same connection. Multiple statements that need to be executed on the same connection with these connection-specific variables will likely fail part-way through execution.
* SQL statements larger than 64 KB are not supported. If you want to insert a batch of records, make sure they are separated into chunks of statements smaller than 64 KB.
* SQL statements that take longer than 45 seconds to complete will timeout. The adasql client does not tell the Data API to continue these statements if they do timeout for data integrity purposes. But, DDL statements that timeout may cause non-reversible changes when canceled.

Your use case may not hit these limitations, in which case have at it! But many use cases will, especially the first and second limitations when attempting to restore a mysqldump backup. You may find you can work around the limitations by:

1. Running mysqldump with the `--extended-insert=FALSE` argument to insert every record using a separate statement to keep statements under 64 KB in size
1. If your tables have foreign key constraints, you may be able to re-order them with children tables and records first, then parent tables and records second, allowing you to create tables and insert records without violating the constraints