/*
 * @author: wes-lin
 * @createTime: 2023-09-08 10:41
 * @lastEditor: tisfeng
 * @lastEditTime: 2023-09-13 09:57
 * @fileName: app.js
 *
 * Copyright (c) 2023 by wes-lin, All Rights Reserved.
 */

/* eslint-disable no-await-in-loop */
const url = require('url');
const log4js = require('log4js');
const recording = require('log4js/lib/appenders/recording');

log4js.configure({
  appenders: {
    vcr: {
      type: 'recording',
    },
    out: {
      type: 'console',
    },
  },
  categories: { default: { appenders: ['vcr', 'out'], level: 'info' } },
});

const logger = log4js.getLogger();
const JSEncrypt = require('node-jsencrypt');
// process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0'
const superagent = require('superagent');
const config = require('../config');
const accounts = require('../accounts');
const serverChan = require('../serverChan');
const telegramBot = require('../telegramBot');

const client = superagent.agent();
const headers = {
  'User-Agent': `Mozilla/5.0 (Linux; U; Android 11; ${config.model} Build/RP1A.201005.001) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/74.0.3729.136 Mobile Safari/537.36 Ecloud/${config.version} Android/30 clientId/${config.clientId} clientModel/${config.model} clientChannelId/qq proVersion/1.0.6`,
  Referer:
    'https://m.cloud.189.cn/zhuanti/2016/sign/index.jsp?albumBackupOpened=1',
  'Accept-Encoding': 'gzip, deflate',
  Host: 'cloud.189.cn',
};

const getEncrypt = () => new Promise((resolve, reject) => {
  if (config.pubKey) {
    resolve(config.pubKey);
    return;
  }
  superagent
    .post('https://open.e.189.cn/api/logbox/config/encryptConf.do')
    .send('appId=cloud')
    .end((err, res) => {
      if (err) {
        reject(err);
        return;
      }
      const json = JSON.parse(res.text);
      if (json.result === 0) {
        resolve(json.data.pubKey);
      } else {
        reject(json.data);
      }
    });
});

const redirectURL = () => new Promise((resolve, reject) => {
  superagent
    .get(
      'https://cloud.189.cn/api/portal/loginUrl.action?redirectURL=https://cloud.189.cn/web/redirect.html?returnURL=/main.action',
    )
    .end((err, res) => {
      if (err) {
        reject(err);
        return;
      }
      const { query } = url.parse(res.redirects[1], true);
      resolve(query);
    });
});

const getLoginFormData = (username, password, encryptKey) => new Promise((resolve, reject) => {
  redirectURL()
    .then((query) => {
      superagent
        .post('https://open.e.189.cn/api/logbox/oauth2/appConf.do')
        .set({
          'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:74.0) Gecko/20100101 Firefox/76.0',
          Referer: 'https://open.e.189.cn/',
          lt: query.lt,
          REQID: query.reqId,
        })
        .type('form')
        .send({
          version: '2.0',
          appKey: 'cloud',
        })
        .end((err, res) => {
          if (err) {
            reject(err);
            return;
          }
          const resData = JSON.parse(res.text);
          if (resData.result === '0') {
            const keyData = `-----BEGIN PUBLIC KEY-----\n${encryptKey}\n-----END PUBLIC KEY-----`;
            const jsencrypt = new JSEncrypt();
            jsencrypt.setPublicKey(keyData);
            const usernameEncrypt = Buffer.from(
              jsencrypt.encrypt(username),
              'base64',
            ).toString('hex');
            const passwordEncrypt = Buffer.from(
              jsencrypt.encrypt(password),
              'base64',
            ).toString('hex');
            const formData = {
              returnUrl: resData.data.returnUrl,
              paramId: resData.data.paramId,
              lt: query.lt,
              REQID: query.reqId,
              userName: `{NRP}${usernameEncrypt}`,
              password: `{NRP}${passwordEncrypt}`,
            };
            resolve(formData);
          } else {
            reject(new Error(resData.msg));
          }
        });
    })
    .catch((err) => {
      reject(err);
    });
});

// 登录
const login = (formData) => new Promise((resolve, reject) => {
  const data = {
    appKey: 'cloud',
    version: '2.0',
    accountType: '01',
    mailSuffix: '@189.cn',
    validateCode: '',
    returnUrl: formData.returnUrl,
    paramId: formData.paramId,
    captchaToken: '',
    dynamicCheck: 'FALSE',
    clientType: '1',
    cb_SaveName: '0',
    isOauth2: false,
    userName: formData.userName,
    password: formData.password,
  };
  superagent
    .post('https://open.e.189.cn/api/logbox/oauth2/loginSubmit.do')
    .set({
      'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:74.0) Gecko/20100101 Firefox/76.0',
      Referer: 'https://open.e.189.cn/',
      lt: formData.lt,
      REQID: formData.REQID,
    })
    .type('form')
    .send(data)
    .end((err, res) => {
      if (err) {
        reject(err);
        return;
      }
      const json = JSON.parse(res.text);
      if (json.result !== 0) {
        reject(json.msg);
        return;
      }
      client
        .get(json.toUrl)
        .set(headers)
        .end((e, r) => {
          if (e) {
            reject(e);
            return;
          }
          resolve(r.statusCode);
        });
    });
});

const doGet = (taskUrl) => new Promise((resolve, reject) => {
  const q = url.parse(taskUrl, true);
  client
    .get(taskUrl)
    .set({
      ...headers,
      Host: q.host,
    })
    .end((err, res) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(JSON.parse(res.text));
    });
});

const mask = (s, start, end) => s.split('').fill('*', start, end).join('');

// 登录流程 1.获取公钥 -> 2.获取登录参数 -> 3.获取登录地址,跳转到登录页
const doLogin = (userName, password) => new Promise((resolve, reject) => {
  getEncrypt()
    .then((encryptKey) => getLoginFormData(userName, password, encryptKey))
    .then((formData) => login(formData))
    .then(() => resolve('登录成功'))
    .catch((error) => {
      logger.error(`登录失败：${JSON.stringify(error)}`);
      reject(error);
    });
});

// 任务 1.签到 2.天天抽红包 3.自动备份抽红包
const doTask = async () => {
  const tasks = [
    `https://cloud.189.cn/mkt/userSign.action?rand=${new Date().getTime()}&clientType=TELEANDROID&version=${
      config.version
    }&model=${config.model}`,
    'https://m.cloud.189.cn/v2/drawPrizeMarketDetails.action?taskId=TASK_SIGNIN&activityId=ACT_SIGNIN',
    'https://m.cloud.189.cn/v2/drawPrizeMarketDetails.action?taskId=TASK_SIGNIN_PHOTOS&activityId=ACT_SIGNIN',
    'https://m.cloud.189.cn/v2/drawPrizeMarketDetails.action?taskId=TASK_2022_FLDFS_KJ&activityId=ACT_SIGNIN',
  ];

  const result = [];
  for (let index = 0; index < tasks.length; index += 1) {
    const task = tasks[index];
    const res = await doGet(task);
    if (index === 0) {
      // 签到
      const signInPrizeLog = `今天${
        res.isSign ? '已经签过到了，' : ''
      }签到获得了 \`${res.netdiskBonus}M\` 云盘空间`;
      result.push(signInPrizeLog);
    } else if (res.errorCode === 'User_Not_Chance') {
      // TODO: 如果已经抽过奖，可以直接显示抽奖结果
      result.push(`第 ${index} 次抽奖失败，抽奖次数不足`);
    } else {
      // 第 1 次抽奖成功，抽奖获得天翼云盘50M空间
      const drawPrizeLog = `第 ${index} 次抽奖成功，抽奖获得${res.prizeName}`;
      const highligthPrizeLog = drawPrizeLog.replace(/云盘(.*?)空间/, '云盘 `$1` 空间');
      result.push(highligthPrizeLog);
    }
  }

  return result;
};

// 推送消息到 ServerChan
const pushServerChan = (title, desp) => {
  if (!serverChan.sendKey) {
    return;
  }
  const data = {
    title,
    desp,
  };
  superagent
    .post(`https://sctapi.ftqq.com/${serverChan.sendKey}.send`)
    .type('form')
    .send(data)
    .end((err, res) => {
      if (err) {
        logger.error(`ServerChan 推送失败：${JSON.stringify(err)}`);
        return;
      }
      const json = JSON.parse(res.text);
      if (json.code !== 0) {
        logger.error(`ServerChan 推送失败：${JSON.stringify(json)}`);
      } else {
        logger.info('ServerChan 推送成功');
      }
    });
};

// 推送消息到 Telegram Bot
const pushTelegramBot = (title, desp) => {
  if (!(telegramBot.botToken && telegramBot.chatId)) {
    return;
  }
  const data = {
    chat_id: telegramBot.chatId,
    text: `${title}\n\n${desp}`,
    parse_mode: 'MarkdownV2',
  };
  superagent
    .post(`https://api.telegram.org/bot${telegramBot.botToken}/sendMessage`)
    .type('form')
    .send(data)
    .end((err, res) => {
      if (err) {
        logger.error(`Telegram Bot 推送失败：${JSON.stringify(err)}`);
        return;
      }
      const json = JSON.parse(res.text);
      if (!json.ok) {
        logger.error(`Telegram Bot 推送失败：${JSON.stringify(json)}`);
      } else {
        logger.info('Telegram Bot 推送成功');
      }
    });
};

// 推送消息到各个平台
const push = (title, desp) => {
  pushServerChan(title, desp);
  pushTelegramBot(title, desp);
};

// 计算获得的空间总数量，例如 "150M"
function countTotalSpace(text) {
  // 使用正则表达式匹配 *M 格式的空间，例如 "50M"
  const regex = /(\d+M)/g;

  // 使用正则表达式匹配所有匹配项
  const matches = text.match(regex);
  let totalSpace = '0M';
  if (matches) {
    // 计算总共获得的 *M 格式的空间数量
    totalSpace = matches.reduce((accumulator, match) => {
      // 使用正则表达式提取数字部分并将其转换为数字
      const spaceValue = parseInt(match, 10);

      // 添加到累加器
      return accumulator + spaceValue;
    }, 0);
  }
  return `${totalSpace}M`;
}

// 开始执行程序
async function main() {
  for (let index = 0; index < accounts.length; index += 1) {
    const account = accounts[index];
    const { userName, password } = account;
    if (userName && password) {
      // 使用``包裹，防止用户名手机号中的星号 133****9999 影响 markdown 消息格式
      const userNameInfo = `\`${mask(userName, 3, 7)}\``;
      let totalSpace = '';

      try {
        logger.log(`账户 ${userNameInfo} 开始执行`);
        await doLogin(userName, password);
        const result = await doTask();
        result.forEach((r) => logger.log(r));

        const content = result.join('  \n');
        // 如果抽奖成功，则统计获得 *M 格式的空间的总数量
        if (content.includes('抽奖成功')) {
          totalSpace = countTotalSpace(content);
        }
      } catch (e) {
        if (e.code === 'ECONNRESET') {
          throw e;
        }
      } finally {
        let accountFinishedLog = `账户 ${userNameInfo} 任务执行完毕`;
        if (totalSpace) {
          accountFinishedLog += `，总共获得云盘空间数量：\`${totalSpace}\``;
        }
        logger.log(accountFinishedLog);
      }
    }
  }
}

(async () => {
  try {
    await main();
  } finally {
    const events = recording.replay();
    const content = events.map((e) => `${e.data.join('')}`).join('  \n');

    const now = new Date();
    const month = now.getMonth() + 1; // 获取月份，注意月份从0开始，所以要加1
    const day = now.getDate(); // 获取日期
    const formattedDate = `${month}月${day}日`;

    push(`${formattedDate}，天翼云盘自动签到任务`, content);
    recording.erase();
  }
})();
