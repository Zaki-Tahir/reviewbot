import { CreateTableCommand, DescribeTableCommand, type DynamoDBClient, ResourceNotFoundException } from "@aws-sdk/client-dynamodb";

/**
 * Creates the table for local development and tests. In AWS the table comes from Terraform
 * (infra/terraform/modules/reviewbot/dynamodb.tf) with the same key schema.
 */
export async function ensureTable(client: DynamoDBClient, name: string): Promise<void> {
  try {
    await client.send(new DescribeTableCommand({ TableName: name }));
    return;
  } catch (err) {
    if (!(err instanceof ResourceNotFoundException)) throw err;
  }
  await client.send(
    new CreateTableCommand({
      TableName: name,
      BillingMode: "PAY_PER_REQUEST",
      AttributeDefinitions: [
        { AttributeName: "PK", AttributeType: "S" },
        { AttributeName: "SK", AttributeType: "S" },
      ],
      KeySchema: [
        { AttributeName: "PK", KeyType: "HASH" },
        { AttributeName: "SK", KeyType: "RANGE" },
      ],
    }),
  );
}
