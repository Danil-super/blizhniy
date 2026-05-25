module.exports = {
  apps: [
    {
      name: "blizhniy",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3000",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};

