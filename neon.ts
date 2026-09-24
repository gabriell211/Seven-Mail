import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  auth: true,
  preview: {
    buckets: {
      assinaturas: { access: "private" },
      pdfs: { access: "private" },
      images: { access: "private" },
    },
    functions: {
      api: { name: "api", source: "./hello.ts" },
    },
  },
});
