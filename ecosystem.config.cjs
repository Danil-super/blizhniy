module.exports = {
  apps: [
    {
      name: "blizhniy",
      script: "node_modules/next/dist/bin/next",
      args: "start -H 127.0.0.1 -p 3000",
      instances: 1,
      exec_mode: "fork",
      cwd: __dirname,
      out_file: `${__dirname}/.pm2/out.log`,
      error_file: `${__dirname}/.pm2/error.log`,
      merge_logs: true,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
