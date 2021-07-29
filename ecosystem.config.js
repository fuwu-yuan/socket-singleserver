module.exports = {
  apps : [{
    name: 'BGEW-Server',
    script: 'index.js',
    exec_interpreter: "node@14.15.0",
    interpreter: "node@14.15.0",
    log_date_format: "YYYY-MM-DD HH:mm Z",

    // Options reference: https://pm2.keymetrics.io/docs/usage/application-declaration/
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'development'
    },
    env_production: {
      NODE_ENV: 'production'
    }
  }],

  deploy : {
    production : {
      user : 'steve',
      host : 'olympe.stevecohen.fr',
      ref  : 'origin/main',
      repo : 'git@github.com:fuwu-yuan/socket-singleserver.git',
      path : '/home/steve/projects/backs/socket-singleserver',
      'post-deploy' : 'cp ../shared/.env .env && npm install && pm2 reload ecosystem.config.js --env production'
    }
  }
};
