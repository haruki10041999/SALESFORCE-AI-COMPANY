import { defineConfig } from "drizzle-kit";

const connectionString = process.env.DATABASE_URL ?? "postgres://sfai:sfai@localhost:5432/sfai";

export default defineConfig({
  schema: "./db/schema/*.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: connectionString
  },
  verbose: true,
  strict: true
});
