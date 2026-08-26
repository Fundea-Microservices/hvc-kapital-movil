module.exports = {
  apps: [
    {
      name: "api-ex",
      script: "main.js",
      cwd: "./",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "500M",
      env: {
        NODE_ENV: "production",
        PORT: 5030,
        TZ: "UTC"
      }
    }
  ]
};
