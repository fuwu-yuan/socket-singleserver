module.exports = {
  apps : [{
    name: 'BGEW-Server',
    script: 'index.js',

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
      ref  : 'origin/master',
      repo : 'git@github.com:fuwu-yuan/socket-singleserver.git',
      path : '/home/steve/projects/backs/socket-singleserver',
      'post-deploy' : 'npm install && pm2 reload ecosystem.config.js --env production'
    }
  }
};
