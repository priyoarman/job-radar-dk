import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Migrations need Neon's direct URL; they can't run through the connection pooler.
    url: process.env["DIRECT_URL"],
  },
});
