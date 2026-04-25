import { MongoClient, type Db } from "mongodb";

const DB_NAME = process.env.MONGODB_DB ?? "unblind";

declare global {
  // eslint-disable-next-line no-var
  var _unblindMongoClient: Promise<MongoClient> | undefined;
}

let cachedClient: Promise<MongoClient> | null = null;

function getClient(): Promise<MongoClient> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error(
      "MONGODB_URI is not set. Add a connection string to .env.",
    );
  }

  if (process.env.NODE_ENV === "development") {
    if (!global._unblindMongoClient) {
      global._unblindMongoClient = new MongoClient(uri).connect();
    }
    return global._unblindMongoClient;
  }

  if (!cachedClient) {
    cachedClient = new MongoClient(uri).connect();
  }
  return cachedClient;
}

export async function getDb(): Promise<Db> {
  const client = await getClient();
  return client.db(DB_NAME);
}
