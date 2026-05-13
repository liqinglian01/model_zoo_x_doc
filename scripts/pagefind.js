const { execSync } = require("child_process");

require("../src/plugins/pagefind-cn-plugin");

execSync(
  "npx pagefind --site build",
  { stdio: "inherit" },
);