import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  auth: true,
  dataApi: true,
  buckets: {
    assinaturas: { access: "private" },
    pdfs: { access: "private" },
    images: { access: "private" },
  },
});
