const standalone = require("node:fs").existsSync(`${__dirname}/server.js`);
const webRuntime = require("./scripts/web-runtime.cjs").getWebRuntime();

module.exports = {
  apps: [
    {
      name: "blizhniy",
      script: standalone ? "server.js" : "node_modules/next/dist/bin/next",
      args: standalone ? "" : "start -H 127.0.0.1 -p 3000",
      interpreter: process.env.BLIZHNIY_NODE_PATH || process.execPath,
      ...webRuntime,
      instances: 1,
      exec_mode: "fork",
      cwd: __dirname,
      out_file: `${__dirname}/.pm2/out.log`,
      error_file: `${__dirname}/.pm2/error.log`,
      merge_logs: true,
      env: {
        NODE_ENV: "production",
        HOSTNAME: "127.0.0.1",
        PORT: "3000",
      },
    },
  ],
};
