// 此插件移植自 https://github.com/shangxueink/koishi-shangxue-apps/tree/main/plugins/emojihub-bili
import fs from 'fs'
import path from 'path'
import axios from 'axios'
import crypto from 'crypto'
import { segment } from 'oicq'
import { fileURLToPath } from 'url'
import plugin from '../../lib/plugins/plugin.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 配置区域,方便修改
const BOT_NICKNAME = '匿名消息' // bot的昵称
const BOT_id = 800000000 // bot的qq
const MAX_EMOJI_COUNT = 100 // 最大表情包数量限制
const RECALL_EMOJI_NAMES = ['涩图', '二次元涩图', '其他表情包名称']; // 需要撤回的表情包名称列表
const RECALL_DELAY_SINGLE = 10; // 单张表情包撤回延迟时间，单位秒
const RECALL_DELAY_MULTI = 40; // 多张表情包撤回延迟时间，单位秒
const DEFAULT_FORWARD_MODE = 'multi'; // 默认转发模式: 'multi' (多层转发) 或 'single' (单层转发) 非NapCatQQ请使用单层转发

// ImageDownloader类:用于高效下载和缓存图片
class ImageDownloader {
  constructor() {
    this.tempDir = path.join(process.cwd(), 'data', 'emojihub-bilibili temp');

    // 确保临时目录存在
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  // 下载图片
  async downloadWithRetry(url, options = {}) {
    const {
      maxRetries = 3,
      timeout = 5000,
      retryDelay = 1000
    } = options;

    logger.debug(`开始下载: ${this._truncateUrl(url)}`);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await axios.get(url, {
          responseType: 'arraybuffer',
          timeout: timeout,
          headers: {
            'User-Agent': 'Mozilla/5.0',
            'Accept': 'image/*',
          },
        });

        const buffer = Buffer.from(response.data);

        // 添加额外的日志
        try {
          const contentType = this.getContentType(buffer);
          const ext = this.getExtensionFromMimeType(contentType);
          logger.debug(`下载成功，ContentType: ${contentType}, 扩展名: ${ext}`);
        } catch (logError) {
          logger.error(`日志记录错误: ${logError.message}`);
        }

        return buffer;
      } catch (error) {
        logger.debug(
          `下载失败 (${this._truncateUrl(url)}) - 尝试 ${attempt}: ${error.response
            ? `HTTP error! status: ${error.response.status}`
            : error.message
          }`
        );

        if (attempt < maxRetries) {
          await new Promise((resolve) =>
            setTimeout(resolve, retryDelay * Math.pow(2, attempt))
          );
        } else {
          // 在最后一次尝试失败后，抛出包含详细信息的错误
          throw new Error(
            `下载失败 (${this._truncateUrl(url)}) - 尝试 ${attempt}: ${error.response
              ? `HTTP error! status: ${error.response.status}`
              : error.message
            }`
          );
        }
      }
    }
  }

  //URL截断方法
  _truncateUrl(url, maxLength = 50) {
    return url.length > maxLength
      ? `${url.substring(0, maxLength)}...`
      : url;
  }

  async downloadToTemp(url, options = {}) {
    const buffer = await this.downloadWithRetry(url, options);
    const hash = this.calculateImageHash(buffer);
    const tempFilePath = path.join(this.tempDir, hash);

    // 将文件写入临时文件夹
    fs.writeFileSync(tempFilePath, buffer);
    return { filePath: tempFilePath, hash };
  }

  // 清理临时文件夹
  async clearTempDir() {
    const files = fs.readdirSync(this.tempDir);
    for (const file of files) {
      const filePath = path.join(this.tempDir, file);
      fs.unlinkSync(filePath);
    }
    logger.info('临时文件夹已清理');
  }

  // 计算图片的哈希值
  calculateImageHash(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  getContentType(buffer) {
    const magicNumbers = {
      'image/jpeg': [0xFF, 0xD8, 0xFF],
      'image/png': [0x89, 0x50, 0x4E, 0x47],
      'image/gif': [0x47, 0x49, 0x46],
      'image/webp': [0x52, 0x49, 0x46, 0x46]
    };

    for (const [type, magic] of Object.entries(magicNumbers)) {
      if (buffer.slice(0, magic.length).equals(Buffer.from(magic))) {
        return type;
      }
    }
    return 'image/jpeg'; // 默认返回 MIME 类型
  }

  // 根据MIME类型获取文件扩展名的辅助方法
  getExtensionFromMimeType(mimeType) {
    switch (mimeType) {
      case 'image/jpeg': return '.jpg';
      case 'image/png': return '.png';
      case 'image/gif': return '.gif';
      case 'image/webp': return '.webp';
      default: return '.jpg';  // 默认使用jpg
    }
  }
}

export class YunzaiEmojihubBilibili extends plugin {
  constructor() {
    super({
      name: 'yunzai-emojihub-bilibili',
      dsc: '来张表情包(于koishi-plugin-emojihub-bili插件移植到yunzaibot)',
      event: 'message',
      priority: 5000,
      rule: [
        {
          reg: '^#?来第(.+?)张(.+?)(?: (本地|哔哩哔哩|b站))?$',
          fnc: 'sendSpecificEmoji'
        },
        {
          reg: '^#?来张(?!随机)(.+?)(?: (本地|哔哩哔哩|b站))?(?: (gif|图片))?$',
          fnc: 'sendEmoji'
        },
        {
          reg: '^#?再来一张(?: (本地|哔哩哔哩|b站))?(?: (gif|图片))?$',
          fnc: 'sendLastEmoji'
        },
        {
          reg: '^#?来张随机(?: (本地|哔哩哔哩|b站))?(?: (gif|图片))?$',
          fnc: 'sendRandomEmoji'
        },
        {
          reg: '^#?来([\u4e00-\u9fa5\\d]+)张(?!随机)(.+?)(?: (本地|哔哩哔哩|b站))?(?: (gif|图片))?$',
          fnc: 'sendMultiEmoji'
        },
        {
          reg: '^#?来([\u4e00-\u9fa5\\d]+)张随机(?: (本地|哔哩哔哩|b站))?(?: (gif|图片))?$',
          fnc: 'sendMultiRandomEmoji'
        },
        {
          reg: '^#?表情包列表$',
          fnc: 'listEmojis'
        },
        {
          reg: '^#?添加表情包(.+)$',
          fnc: 'addEmoji',
          permission: "master"
        },
        {
          reg: '^#?删除表情包 *(.+) *(\\d+)$',
          fnc: 'deleteEmoji',
          permission: "master"
        },
        {
          reg: '^#?查看表情包(.+)$',
          fnc: 'viewEmoji'
        },
        {
          reg: '^#?切换表情包转发模式$',
          fnc: 'toggleForwardMode',
          permission: "master"
        },
        {
          reg: '^#?表情包帮助$',
          fnc: 'helpEmoji'
        }
      ]
    })

    this.downloader = new ImageDownloader();
    this.emojiPath = path.join(__dirname, 'emojihub-bilibili')
    this.configPath = path.join(__dirname, 'yunzai-emojihub-bilibili.json')
    this.loadConfig()
    this.forwardMode = this.config.forwardMode || DEFAULT_FORWARD_MODE;
  }

  loadConfig() {
    if (fs.existsSync(this.configPath)) {
      this.config = JSON.parse(fs.readFileSync(this.configPath, 'utf8'))
    } else {
      this.config = {}
    }
  }

  saveConfig() {
    fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2))
  }

  updateLastUsed(groupId, emojiName) {
    if (!this.config[groupId]) {
      this.config[groupId] = {}
    }
    this.config[groupId].lastUsed = emojiName
    this.saveConfig()
  }

  parseParams(paramsStr) {
    let source = 'all'
    let type = 'all'
    if (paramsStr) {
      const params = paramsStr.split(' ')
      for (const param of params) {
        if (param === '本地') {
          source = 'local'
        } else if (param === '哔哩哔哩' || param === 'b站') {
          source = 'bilibili'
        } else if (param === 'gif') {
          type = 'gif'
        } else if (param === '图片') {
          type = 'image'
        }
      }
    }
    return { source, type }
  }

  getEmojiContent(emojiName) {
    const folderPath = path.join(this.emojiPath, emojiName)
    const txtPath = path.join(folderPath, `${emojiName}.txt`)
    let urls = []
    let localFiles = []

    if (fs.existsSync(txtPath)) {
      const content = fs.readFileSync(txtPath, 'utf8')
      urls = content.split('\n').filter(url => url.trim()).map(url => this.adaptUrl(url.trim()))
    }

    if (fs.existsSync(folderPath)) {
      localFiles = fs.readdirSync(folderPath)
        .filter(file => /\.(jpg|jpeg|png|gif|webp)$/i.test(file))
        .map(file => path.join(folderPath, file))
    }

    return { urls, localFiles }
  }

  adaptUrl(url) {
    if (url.startsWith('http')) {
      return url;
    } else if (url.startsWith('new_dyn/') || url.startsWith('article/') || url.startsWith('vc/') || url.startsWith('bfs/')) { // 添加了vc/和bfs/的情况
      return `https://i0.hdslb.com/bfs/${url}`;
    } else if (url.match(/^(?:new_dyn|article|vc|bfs)\//)) {
      return `https://i0.hdslb.com/${url}`;
    }
    return url;
  }

  // 中文数字转阿拉伯数字
  chineseToNumber(chineseStr) {
    const chineseNumMap = { '零': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
    const chineseUnitMap = { '十': 10, '百': 100, '千': 1000 };
    const chineseSectionUnitMap = { '万': 10000, '亿': 100000000 };
    const sectionToNumber = (sectionStr) => {
      let result = 0;
      let temp = 0;
      for (let i = 0; i < sectionStr.length; i++) {
        const char = sectionStr[i];
        if (chineseNumMap.hasOwnProperty(char)) {
          temp = chineseNumMap[char];
          if (i === sectionStr.length - 1) {
            result += temp;
          }
        } else if (chineseUnitMap.hasOwnProperty(char)) {
          const unit = chineseUnitMap[char];
          if (temp === 0) {
            temp = 1;
          }
          result += temp * unit;
          temp = 0;
        }
      }
      return result;
    };

    let totalResult = 0;
    let tempResult = 0;
    let currentSection = '';

    for (let i = 0; i < chineseStr.length; i++) {
      const char = chineseStr[i];
      if (chineseSectionUnitMap.hasOwnProperty(char)) {
        const unit = chineseSectionUnitMap[char];
        tempResult = (sectionToNumber(currentSection) || (currentSection ? 0 : 1)) * unit;
        totalResult += tempResult;
        currentSection = '';
      } else {
        currentSection += char;
      }
    }
    if (currentSection) {
      totalResult += sectionToNumber(currentSection);
    }

    return totalResult;
  }

  // 解析编号字符串，支持多种格式：1, 1-3, 1到3, 1 2 3, 1-3 5 7-9
  parseNumberString(numberStr) {
    const numbers = new Set();
    
    // 将中文数字和范围符号替换为标准格式
    const standardizedStr = numberStr
      .replace(/到/g, '-')
      .replace(/[\u4e00-\u9fa5]+/g, (match) => {
        if (match === '到') return '-';
        return this.chineseToNumber(match);
      })
      .replace(/(\d+)\s*-\s*(\d+)/g, '$1-$2');

    const parts = standardizedStr.trim().split(/\s+/);
    
    for (const part of parts) {
      if (part.includes('-')) {
        const [start, end] = part.split('-').map(s => parseInt(s.trim()));
        
        if (!isNaN(start) && !isNaN(end) && start <= end) {
          for (let i = start; i <= end; i++) {
            numbers.add(i);
          }
        }
      } else {
        const num = parseInt(part);
        if (!isNaN(num)) {
          numbers.add(num);
        }
      }
    }
    
    return Array.from(numbers).sort((a, b) => a - b);
  }

  async sendImage(filePath, e) {
    try {
      // 直接发送文件路径
      const res = await this.reply(segment.image(`file://${filePath}`));
      return res; // 返回发送结果
    } catch (error) {
      logger.error(`发送图片错误:${error}`);
      await this.reply('发送图片时出错,请稍后重试');
      return false;
    }
  }

  filterEmojis(emojis, { source, type }) {
    let filteredEmojis = [];

    if (source === 'all' && type === 'all') {
      filteredEmojis = emojis;
    } else {
      filteredEmojis = emojis.filter(emoji => {
        const isLocal = !emoji.startsWith('http');
        const isGif = emoji.toLowerCase().endsWith('.gif');
        const isImage = /\.(jpg|jpeg|png|webp)$/i.test(emoji);

        const sourceMatch = (source === 'all') ||
          (source === 'local' && isLocal) ||
          (source === 'bilibili' && !isLocal);

        const typeMatch = (type === 'all') ||
          (type === 'gif' && isGif) ||
          (type === 'image' && isImage);

        return sourceMatch && typeMatch;
      });
    }
    return filteredEmojis;
  }

  // 来第xx张xx命令
  async sendSpecificEmoji(e) {
    try {
      const match = e.msg.match(/^#?来第(.+?)张(.+?)(?: (本地|哔哩哔哩|b站))?$/);
      if (!match) return false;

      const numberStr = match[1].trim();
      const emojiName = match[2].trim();
      let source = match[3] ? (match[3] === '本地' ? 'local' : 'bilibili') : 'local'; // 默认本地
      let sourceForMessage = source;

      // 解析编号
      const numbers = this.parseNumberString(numberStr);
      
      if (numbers.length === 0) {
        await this.reply('编号格式错误，请输入有效的数字或范围');
        return true;
      }

      // 获取表情包内容
      const { urls, localFiles } = this.getEmojiContent(emojiName);
      
      if (urls.length === 0 && localFiles.length === 0) {
        await this.reply(`未找到 ${emojiName} 表情包或表情包是空的`);
        return true;
      }

      // 根据来源筛选
      let targetEmojis = [];
      if (source === 'local') {
        if (localFiles.length > 0) {
          targetEmojis = localFiles;
        } else if (urls.length > 0) {
          targetEmojis = urls;
          sourceForMessage = 'bilibili';
        }
      } else {
        targetEmojis = urls;
      }

      if (targetEmojis.length === 0) {
        await this.reply(`未找到${source === 'local' ? '本地' : '哔哩哔哩'}的 ${emojiName} 表情包`);
        return true;
      }

      // 获取指定编号的表情包
      const selectedFiles = [];
      const invalidNumbers = [];
      
      for (const num of numbers) {
        let emoji = null;

        // 优先根据文件名编号查找
        if (source === 'local' && localFiles.length > 0) {
          const numStr = String(num);
          const foundFile = localFiles.find(file => path.parse(file).name === numStr);
          if (foundFile) {
            emoji = foundFile;
          }
        }
        if (!emoji) {
          if (num < 1 || num > targetEmojis.length) {
            invalidNumbers.push(num);
            continue;
          }
          emoji = targetEmojis[num - 1];
        }
        
        try {
          let filePath;
          if (emoji.startsWith('http')) {
            const result = await this.downloader.downloadToTemp(emoji, {
              timeout: 10000,
              retryDelay: 1000,
              maxRetries: 3
            });
            filePath = result.filePath;
          } else {
            filePath = emoji;
          }
          if (filePath) {
            selectedFiles.push(filePath);
          }
        } catch (error) {
          logger.error(`获取第${num}张表情包失败: ${error}`);
        }
      }

      // 提示无效编号
      if (invalidNumbers.length > 0) {
        await this.reply(`以下编号超出范围: ${invalidNumbers.join(', ')}，${emojiName}（${sourceForMessage === 'local' ? '本地' : '哔哩哔哩'}）表情包共${targetEmojis.length}张`);
      }

      if (selectedFiles.length === 0) {
        if (invalidNumbers.length === 0) {
          await this.reply('没有成功获取到任何表情包');
        }
        return true;
      }
      this.updateLastUsed(e.group_id || e.user_id, emojiName);

      let msg_id;

      // 如果只有一张图片，直接发送
      if (selectedFiles.length === 1) {
        const res = await this.sendImage(selectedFiles[0], e);
        msg_id = res?.message_id;
      } else if (this.forwardMode === 'single') {
        // 单层转发模式
        const innerNodes = selectedFiles.map(file => ({
          type: 'node',
          data: {
            nickname: BOT_NICKNAME,
            user_id: BOT_id,
            content: [{
              type: 'image',
              data: {
                file: `file://${file}`
              }
            }]
          }
        }));

        if (e.isGroup) {
          const res = await e.bot.sendApi('send_group_forward_msg', {
            group_id: e.group_id,
            messages: innerNodes
          });
          msg_id = res?.data?.message_id;
        } else {
          const res = await e.bot.sendApi('send_private_forward_msg', {
            user_id: e.user_id,
            messages: innerNodes
          });
          msg_id = res?.data?.message_id;
        }
      } else {
        // 多层转发模式
        const innerNodes = [];
        for (const file of selectedFiles) {
          innerNodes.push({
            type: 'node',
            data: {
              nickname: BOT_NICKNAME,
              user_id: BOT_id,
              content: [{
                type: 'image',
                data: {
                  file: `file://${file}`
                }
              }]
            }
          });
        }

        const outerNode = {
          type: 'node',
          data: {
            nickname: BOT_NICKNAME,
            user_id: BOT_id,
            content: innerNodes
          }
        };

        if (e.isGroup) {
          const res = await e.bot.sendApi('send_group_forward_msg', {
            group_id: e.group_id,
            messages: [outerNode]
          });
          msg_id = res?.data?.message_id;
        } else {
          const res = await e.bot.sendApi('send_private_forward_msg', {
            user_id: e.user_id,
            messages: [outerNode]
          });
          msg_id = res?.data?.message_id;
        }
      }

      // 检查是否需要撤回
      if (msg_id && RECALL_EMOJI_NAMES.includes(emojiName)) {
        const delay = selectedFiles.length === 1 ? RECALL_DELAY_SINGLE : RECALL_DELAY_MULTI;
        setTimeout(async () => {
          try {
            await e.bot.sendApi('delete_msg', { message_id: msg_id });
            logger.info(`已撤回消息 ${msg_id}`);
          } catch (err) {
            logger.error(`撤回消息 ${msg_id} 失败: ${err}`);
          }
        }, delay * 1000);
      }

      // 清理临时文件夹
      await this.downloader.clearTempDir();

      return true;
    } catch (error) {
      logger.error(`发送指定编号表情包错误: ${error}`);
      await this.reply('发送表情包时出错，请稍后重试');
      return false;
    }
  }

  // 来张xx命令
  async sendEmoji(e) {
    try {
      const match = e.msg.match(/^#?来张(.+?)(?: (本地|哔哩哔哩|b站))?(?: (gif|图片))?$/)
      if (!match) return false
      const emojiName = match[1].trim()
      const paramsStr = `${match[2] || ''} ${match[3] || ''}`.trim()
      const params = this.parseParams(paramsStr)
      const { urls, localFiles } = this.getEmojiContent(emojiName)
      if (urls.length === 0 && localFiles.length === 0) {
        await this.reply(`未找到 ${emojiName} 表情包或表情包是空的`)
        return true
      }
      const allEmojis = [...urls, ...localFiles]
      const filteredEmojis = this.filterEmojis(allEmojis, params)
      if (filteredEmojis.length === 0) {
        let errorMessage = `未找到符合条件的 ${emojiName} 表情包`
        if (params.source !== 'all') {
          errorMessage += `(${params.source === 'local' ? '本地' : '哔哩哔哩'})`
        }
        if (params.type !== 'all') {
          errorMessage += `(${params.type === 'gif' ? 'gif' : '图片'})`
        }
        await this.reply(errorMessage)
        return true
      }
      const randomEmoji = filteredEmojis[Math.floor(Math.random() * filteredEmojis.length)];
      this.updateLastUsed(e.group_id || e.user_id, emojiName);
      let msg_id;
      let filePathToSend;
      // 如果是本地文件，直接使用路径；如果是网络图片，先下载到临时目录再使用路径
      if (randomEmoji.startsWith('http')) {
        try {
          const { filePath } = await this.downloader.downloadToTemp(randomEmoji, {
            timeout: 10000,
            retryDelay: 1000,
            maxRetries: 3
          });
          filePathToSend = filePath;
        } catch (error) {
          logger.error(`下载图片错误:${error}`);
          await this.reply('下载表情包时出错,请稍后重试');
          return false;
        }
      } else {
        filePathToSend = randomEmoji;
      }
      // 发送图片
      try {
        const res = await this.sendImage(filePathToSend, e);
        msg_id = res?.message_id;
      } catch (error) {
        logger.error(`发送图片错误:${error}`);
        await this.reply('发送表情包时出错,请稍后重试');
        return false;
      }
      // 检查是否需要撤回
      if (msg_id && RECALL_EMOJI_NAMES.includes(emojiName)) {
        setTimeout(async () => {
          try {
            await e.bot.sendApi('delete_msg', { message_id: msg_id });
            logger.info(`已撤回消息 ${msg_id}`);
          } catch (err) {
            logger.error(`撤回消息 ${msg_id} 失败: ${err}`);
          }
        }, RECALL_DELAY_SINGLE * 1000);
      }
      return true;
    } catch (error) {
      logger.error(`发送表情包错误:${error}`)
      await this.reply('发送表情包时出错,请稍后重试')
      return false
    }
  }

  // 再来一张命令
  async sendLastEmoji(e) {
    try {
      const groupId = e.group_id || e.user_id
      const lastUsed = this.config[groupId]?.lastUsed

      if (!lastUsed) {
        await this.reply('还没有使用过表情包呢,请先发送"来张xx"使用一个表情包')
        return true
      }

      const match = e.msg.match(/^#?再来一张(?: (本地|哔哩哔哩|b站))?(?: (gif|图片))?$/)
      const paramsStr = `${match[1] || ''} ${match[2] || ''}`.trim()
      const params = this.parseParams(paramsStr)

      e.msg = `来张${lastUsed} ${paramsStr}`.trim()
      const result = await this.sendEmoji(e);

      if (!result) {
        return false;
      }

      return true
    } catch (error) {
      logger.error(`发送上一个表情包错误:${error}`)
      await this.reply('发送表情包时出错,请稍后重试')
      return false
    }
  }

  // 来张随机命令
  async sendRandomEmoji(e) {
    try {
      const emojiDirs = fs.readdirSync(this.emojiPath).filter(file => fs.statSync(path.join(this.emojiPath, file)).isDirectory());

      if (emojiDirs.length === 0) {
        await this.reply('没有找到任何表情包分类');
        return true;
      }

      const match = e.msg.match(/^#?来张随机(?: (本地|哔哩哔哩|b站))?(?: (gif|图片))?$/);
      const paramsStr = `${match[1] || ''} ${match[2] || ''}`.trim();
      const params = this.parseParams(paramsStr);

      let availableEmojis = [];
      for (const dir of emojiDirs) {
        const { urls, localFiles } = this.getEmojiContent(dir);
        availableEmojis.push(...this.filterEmojis([...urls, ...localFiles], params));
      }

      if (availableEmojis.length === 0) {
        await this.reply('没有找到符合条件的随机表情包');
        return true;
      }

      const randomEmoji = availableEmojis[Math.floor(Math.random() * availableEmojis.length)];
      const emojiName = emojiDirs.find(dir => this.getEmojiContent(dir).localFiles.includes(randomEmoji) || this.getEmojiContent(dir).urls.includes(randomEmoji));
      this.updateLastUsed(e.group_id || e.user_id, emojiName);
      let msg_id;
      // 如果是本地文件，直接发送；如果是网络图片，先下载到临时目录再发送
      if (randomEmoji.startsWith('http')) {
        try {
          const { filePath } = await this.downloader.downloadToTemp(randomEmoji, {
            timeout: 10000,
            retryDelay: 1000,
            maxRetries: 3
          });
          const res = await this.sendImage(filePath, e);
          msg_id = res?.message_id;
        } catch (error) {
          logger.error(`下载或发送图片错误:${error}`);
          await this.reply('发送表情包时出错,请稍后重试');
          return false;
        }
      } else {
        const res = await this.sendImage(randomEmoji, e);
        msg_id = res?.message_id;
      }

      // 检查是否需要撤回
      if (msg_id && RECALL_EMOJI_NAMES.includes(emojiName)) {
        setTimeout(async () => {
          try {
            await e.bot.sendApi('delete_msg', { message_id: msg_id });
            logger.info(`已撤回消息 ${msg_id}`);
          } catch (err) {
            logger.error(`撤回消息 ${msg_id} 失败: ${err}`);
          }
        }, RECALL_DELAY_SINGLE * 1000);
      }

      return true;

    } catch (error) {
      logger.error(`发送随机表情包错误:${error}`);
      await this.reply('发送随机表情包时出错,请稍后重试');
      return false;
    }
  }

  // 多张表情包命令
  async sendMultiEmoji(e) {
    const match = e.msg.match(/^#?来([\u4e00-\u9fa5\d]+)张(.+?)(?: (本地|哔哩哔哩|b站))?(?: (gif|图片))?$/)
    if (!match) return false
    let count = match[1];
    // 尝试将中文数字转换为阿拉伯数字
    if (/^[\u4e00-\u9fa5]+$/.test(count)) {
      count = this.chineseToNumber(count);
    } else {
      count = parseInt(count);
    }
    if (isNaN(count)) {
      await this.reply('数量格式错误,请输入数字或中文数字');
      return true;
    }
    const emojiName = match[2].trim()
    const paramsStr = `${match[3] || ''} ${match[4] || ''}`.trim()
    const params = this.parseParams(paramsStr)
    if (count > MAX_EMOJI_COUNT) {
      await this.reply(`表情包数量不能超过${MAX_EMOJI_COUNT}张`)
      return true
    }

    const { urls, localFiles } = this.getEmojiContent(emojiName)
    const allEmojis = [...urls, ...localFiles]
    const filteredEmojis = this.filterEmojis(allEmojis, params)

    if (filteredEmojis.length === 0) {
      let errorMessage = `未找到符合条件的 ${emojiName} 表情包`
      if (params.source !== 'all') {
        errorMessage += `(${params.source === 'local' ? '本地' : '哔哩哔哩'})`
      }
      if (params.type !== 'all') {
        errorMessage += `(${params.type === 'gif' ? 'gif' : '图片'})`
      }
      await this.reply(errorMessage)
      return true
    }

    const selectedPaths = new Set();
    const selectedFiles = [];

    while (selectedFiles.length < count && selectedPaths.size < filteredEmojis.length) {
      const randomIndex = Math.floor(Math.random() * filteredEmojis.length);
      const emoji = filteredEmojis[randomIndex];

      try {
        let filePath;
        if (emoji.startsWith('http')) {
          const result = await this.downloader.downloadToTemp(emoji, {
            timeout: 10000,
            retryDelay: 1000,
            maxRetries: 3
          });
          filePath = result.filePath;
        } else {
          filePath = emoji;
        }

        if (!selectedPaths.has(filePath)) {
          selectedFiles.push(filePath);
          selectedPaths.add(filePath);
        }
      } catch (error) {
        console.error(`处理图片 ${emoji} 失败:`, error);
      }
    }

    this.updateLastUsed(e.group_id || e.user_id, emojiName);
    let msg_id;
    // 如果只有一张图片，直接发送
    if (selectedFiles.length === 1) {
      const res = await this.sendImage(selectedFiles[0], e);
      msg_id = res?.message_id;
    } else if (this.forwardMode === 'single') {
      // 单层转发模式
      const innerNodes = selectedFiles.map(file => ({
        type: 'node',
        data: {
          nickname: BOT_NICKNAME,
          user_id: BOT_id,
          content: [{
            type: 'image',
            data: {
              file: `file://${file}`
            }
          }]
        }
      }));
      if (e.isGroup) {
        const res = await e.bot.sendApi('send_group_forward_msg', {
          group_id: e.group_id,
          messages: innerNodes
        });
        msg_id = res?.data?.message_id;
      } else {
        const res = await e.bot.sendApi('send_private_forward_msg', {
          user_id: e.user_id,
          messages: innerNodes
        });
        msg_id = res?.data?.message_id;
      }
      // 延迟撤回
      if (msg_id && RECALL_EMOJI_NAMES.includes(emojiName)) {
        setTimeout(async () => {
          try {
            await e.bot.sendApi('delete_msg', { message_id: msg_id });
            logger.info(`已撤回消息 ${msg_id}`);
          } catch (err) {
            logger.error(`撤回消息 ${msg_id} 失败: ${err}`);
          }
        }, RECALL_DELAY_MULTI * 1000);
      }
    } else {
      // 多层转发模式
      const innerNodes = [];
      for (const file of selectedFiles) {
        innerNodes.push({
          type: 'node',
          data: {
            nickname: BOT_NICKNAME,
            user_id: BOT_id,
            content: [{
              type: 'image',
              data: {
                file: `file://${file}`
              }
            }]
          }
        });
      }
      const outerNode = {
        type: 'node',
        data: {
          nickname: BOT_NICKNAME,
          user_id: BOT_id,
          content: innerNodes
        }
      };
      if (e.isGroup) {
        const res = await e.bot.sendApi('send_group_forward_msg', {
          group_id: e.group_id,
          messages: [outerNode]
        });
        msg_id = res?.data?.message_id;
      } else {
        const res = await e.bot.sendApi('send_private_forward_msg', {
          user_id: e.user_id,
          messages: [outerNode]
        });
        msg_id = res?.data?.message_id;
      }
      // 延迟撤回
      if (msg_id && RECALL_EMOJI_NAMES.includes(emojiName)) {
        setTimeout(async () => {
          try {
            await e.bot.sendApi('delete_msg', { message_id: msg_id });
            logger.info(`已撤回消息 ${msg_id}`);
          } catch (err) {
            logger.error(`撤回消息 ${msg_id} 失败: ${err}`);
          }
        }, RECALL_DELAY_MULTI * 1000);
      }
    }

    // 清理临时文件夹
    await this.downloader.clearTempDir();

    return true;
  }

  // 多张随机表情包命令
  async sendMultiRandomEmoji(e) {
    const match = e.msg.match(/^#?来([\u4e00-\u9fa5\d]+)张随机(?: (本地|哔哩哔哩|b站))?(?: (gif|图片))?$/)
    if (!match) return false
    let count = match[1];
    // 尝试将中文数字转换为阿拉伯数字
    if (/^[\u4e00-\u9fa5]+$/.test(count)) {
      count = this.chineseToNumber(count);
    } else {
      count = parseInt(count);
    }
    if (isNaN(count)) {
      await this.reply('数量格式错误,请输入数字或中文数字');
      return true;
    }
    const paramsStr = `${match[2] || ''} ${match[3] || ''}`.trim()
    const params = this.parseParams(paramsStr)
    if (count > MAX_EMOJI_COUNT) {
      await this.reply(`表情包数量不能超过${MAX_EMOJI_COUNT}张`)
      return true
    }

    const files = fs.readdirSync(this.emojiPath)
      .filter(file => fs.statSync(path.join(this.emojiPath, file)).isDirectory())

    if (files.length === 0) {
      await this.reply('没有找到任何表情包')
      return true
    }

    const selectedPaths = new Set();
    const selectedFilesForForward = [];
    let shouldRecall = false;

    let i = 0;
    while (i < count) {
      const randomDir = files[Math.floor(Math.random() * files.length)];
      const { urls, localFiles } = this.getEmojiContent(randomDir);
      const filteredEmojis = this.filterEmojis([...urls, ...localFiles], params);

      if (filteredEmojis.length > 0) {
        // 随机选择一个表情
        const randomEmoji = filteredEmojis[Math.floor(Math.random() * filteredEmojis.length)];

        try {
          let filePath;
          if (randomEmoji.startsWith('http')) {
            // 下载图片并获取路径
            const result = await this.downloader.downloadToTemp(randomEmoji, {
              timeout: 10000,
              retryDelay: 1000,
              maxRetries: 3
            });
            filePath = result.filePath;
          } else {
            // 本地文件，直接使用路径
            filePath = randomEmoji;
          }

          // 检查路径是否已存在
          if (!selectedPaths.has(filePath)) {
            selectedFilesForForward.push(filePath);
            selectedPaths.add(filePath);
            i++;

            // 检查是否需要撤回
            if (RECALL_EMOJI_NAMES.includes(randomDir)) {
              shouldRecall = true;
            }
          } else {
            logger.info(`图片 ${randomEmoji} 的路径已存在，跳过`);
          }
        } catch (error) {
          console.error(`处理图片 ${randomEmoji} 失败:`, error);
        }
      }
    }

    if (selectedFilesForForward.length === 0) {
      await this.reply('没有找到足够数量的不重复表情包');
      return true;
    }

    let msg_id;
    if (selectedFilesForForward.length === 1) {
      // 如果只有一张图片，直接发送
      const res = await this.sendImage(selectedFilesForForward[0], e);
      msg_id = res?.message_id;
    } else if (this.forwardMode === 'single') {
      // 单层转发模式
      const innerNodes = selectedFilesForForward.map(file => ({
        type: 'node',
        data: {
          nickname: BOT_NICKNAME,
          user_id: BOT_id,
          content: [{
            type: 'image',
            data: {
              file: `file://${file}`
            }
          }]
        }
      }));
      if (e.isGroup) {
        const res = await e.bot.sendApi('send_group_forward_msg', {
          group_id: e.group_id,
          messages: innerNodes
        });
        msg_id = res?.data?.message_id;
      } else {
        const res = await e.bot.sendApi('send_private_forward_msg', {
          user_id: e.user_id,
          messages: innerNodes
        });
        msg_id = res?.data?.message_id;
      }
      // 延迟撤回
      if (msg_id && shouldRecall) {
        setTimeout(async () => {
          try {
            await e.bot.sendApi('delete_msg', { message_id: msg_id });
            logger.info(`已撤回消息 ${msg_id}`);
          } catch (err) {
            logger.error(`撤回消息 ${msg_id} 失败: ${err}`);
          }
        }, RECALL_DELAY_MULTI * 1000);
      }
    } else {
      // 多层转发模式
      const innerNodes = [];
      for (const file of selectedFilesForForward) {
        innerNodes.push({
          type: 'node',
          data: {
            nickname: BOT_NICKNAME,
            user_id: BOT_id,
            content: [{
              type: 'image',
              data: {
                file: `file://${file}`
              }
            }]
          }
        });
      }
      const outerNode = {
        type: 'node',
        data: {
          nickname: BOT_NICKNAME,
          user_id: BOT_id,
          content: innerNodes
        }
      };
      if (e.isGroup) {
        const res = await e.bot.sendApi('send_group_forward_msg', {
          group_id: e.group_id,
          messages: [outerNode]
        });
        msg_id = res?.data?.message_id;
      } else {
        const res = await e.bot.sendApi('send_private_forward_msg', {
          user_id: e.user_id,
          messages: [outerNode]
        });
        msg_id = res?.data?.message_id;
      }
    }
    // 延迟撤回
    if (msg_id && shouldRecall) {
      setTimeout(async () => {
        try {
          await e.bot.sendApi('delete_msg', { message_id: msg_id });
          logger.info(`已撤回消息 ${msg_id}`);
        } catch (err) {
          logger.error(`撤回消息 ${msg_id} 失败: ${err}`);
        }
      }, RECALL_DELAY_MULTI * 1000);
    }

    // 清理临时文件夹
    await this.downloader.clearTempDir();

    return true;
  }

  // 表情包列表命令
  async listEmojis(e) {
    try {
      const files = fs.readdirSync(this.emojiPath)
      const validEmojis = files.filter(file =>
        fs.statSync(path.join(this.emojiPath, file)).isDirectory()
      )

      let message = '可用表情包列表:\n'
      validEmojis.forEach((emoji, index) => {
        message += `${index + 1}. ${emoji}\n`
      })
      message += '发送"来张xx"即可使用对应表情包'

      await this.reply(await e.group.makeForwardMsg([
        {
          message: message,
          nickname: BOT_NICKNAME,
          user_id: BOT_id
        }
      ]))
      return true
    } catch (error) {
      logger.error(`获取表情包列表错误:${error}`)
      await this.reply('获取表情包列表失败')
      return false
    }
  }

  // 添加表情包命令
  async addEmoji(e) {
    try {
      let imageUrls = [];

      // 优先处理引用回复的图片
      if (e?.reply_id !== undefined) {
        const replyMsg = await e.getReply();
        if (!replyMsg) {
          await this.reply('获取引用消息失败');
          return true;
        }

        const message = replyMsg.message || replyMsg;
        const replyImgs = Array.isArray(message)
          ? message.filter(item => item.type === 'image')
          : (message?.image || message?.img ? [message] : []);

        for (let img of replyImgs) {
          const imageUrl = img.url || img.data?.url || img;
          imageUrls.push(imageUrl);
        }
      }

      // 如果没有引用回复图片，则尝试获取消息中的图片
      if (imageUrls.length === 0 && e.img && e.img.length > 0) {
        imageUrls = e.img;
      }

      // 尝试从转发消息中获取图片
      if (imageUrls.length === 0) {
        const forwardImages = await this.getImagesFromForwardMsg(e);
        imageUrls = forwardImages;
      }

      if (imageUrls.length === 0) {
        await this.reply('请附带要添加的表情图片或回复一张图片以及回复转发消息');
        return true;
      }

      // 获取表情包名称和文件夹路径
      const match = e.msg.match(/^#?添加表情包 *(.+)$/);
      if (!match) {
        await this.reply('命令格式错误,请使用:添加表情包<名称>');
        return true;
      }
      const emojiName = match[1].trim();
      const folderPath = path.join(this.emojiPath, emojiName);

      // 确保文件夹存在
      let isNewFolder = false;
      if (!fs.existsSync(folderPath)) {
        try {
          fs.mkdirSync(folderPath, { recursive: true });
          isNewFolder = true;
        } catch (mkdirError) {
          await this.reply(`创建文件夹${emojiName}失败:${mkdirError.message}`);
          return true;
        }
      }

      // 获取文件夹中已存在的图片的哈希值集合
      const existingFiles = fs.readdirSync(folderPath)
        .filter(file => /\.(jpg|jpeg|png|gif|webp)$/i.test(file));

      const existingHashes = new Set();
      for (const file of existingFiles) {
        const filePath = path.join(folderPath, file);
        const buffer = fs.readFileSync(filePath);
        const hash = this.downloader.calculateImageHash(buffer);
        existingHashes.add(hash);
      }

      // 下载并保存多张图片
      const savedImageNumbers = [];
      const duplicateUrls = []; // 用于存放重复的图片信息
      const failedUrls = []; // 只保留真正下载失败的图片信息

      for (let i = 0; i < imageUrls.length; i++) {
        try {
          const buffer = await this.downloader.downloadWithRetry(imageUrls[i], {
            timeout: 10000,
            retryDelay: 1000,
            maxRetries: 3
          });
          const hash = this.downloader.calculateImageHash(buffer);

          // 检查哈希值是否已存在
          if (existingHashes.has(hash)) {
            logger.info(`图片 ${imageUrls[i]} 已存在，跳过保存`);
            duplicateUrls.push({
              url: imageUrls[i],
              message: '图片已存在'
            });
            continue; // 跳过保存
          }

          const contentType = this.downloader.getContentType(buffer);
          const ext = this.downloader.getExtensionFromMimeType(contentType);
          // 查找最小的未使用的正整数编号
          const existingNumbers = new Set(existingFiles
            .map(file => {
              const match = file.match(/^(\d+)\./);
              return match ? parseInt(match[1]) : NaN;
            })
            .filter(num => !isNaN(num))
          );
          let nextNumber = 1;
          while (existingNumbers.has(nextNumber)) {
            nextNumber++;
          }
          const newFileName = `${nextNumber}${ext}`;
          const newFilePath = path.join(folderPath, newFileName);
          fs.writeFileSync(newFilePath, buffer);
          existingHashes.add(hash); // 保存后将新的哈希值添加到集合中
          savedImageNumbers.push(nextNumber);
          existingFiles.push(newFileName); // 更新文件列表，方便后续图片查找下一个编号
        } catch (downloadError) {
          failedUrls.push({
            url: imageUrls[i],
            error: downloadError.message
          });
        }
      }

      // 发送成功提示信息
      let message = '';
      if (savedImageNumbers.length > 0) {
        if (isNewFolder) {
          if (savedImageNumbers.length === 1) {
            message += `创建表情包分类${emojiName}并添加第1张图片成功`;
          } else {
            message += `创建表情包分类${emojiName}并添加第1-${savedImageNumbers.length}张图片成功`;
          }
        } else {
          if (savedImageNumbers.length === 1) {
            message += `添加表情包${emojiName}第${savedImageNumbers[0]}张图片成功`;
          } else {
            message += `添加表情包${emojiName}第${savedImageNumbers[0]}-${savedImageNumbers[savedImageNumbers.length - 1]}张图片成功`;
          }
        }
      }

      // 添加重复图片提示
      if (duplicateUrls.length > 0) {
        if (savedImageNumbers.length > 0) {
          // 情况一：既有成功添加的图片，也有重复的图片
          message += `\n有${duplicateUrls.length}张图片存在，已跳过保存`;
        } else if (imageUrls.length === 1) {
          // 情况二：添加单张图片且图片已存在
          message = `此图片已存在，跳过保存`;
        } else {
          // 情况三：添加多张图片且所有图片都重复
          message = `所有图片已存在，已跳过保存`;
        }
      }

      // 转发下载失败的错误信息
      if (failedUrls.length > 0) {
        let errorMessage = `共 ${failedUrls.length} 张图片下载失败:\n`;
        failedUrls.forEach((failedUrl, index) => {
          errorMessage += `${index + 1}. ${failedUrl.url} (原因: ${failedUrl.error})\n`;
        });

        await this.reply(await e.group.makeForwardMsg([
          {
            message: errorMessage.trim(),
            nickname: BOT_NICKNAME,
            user_id: BOT_id
          }
        ]));
      }

      // 发送提示信息
      if (message) {
        await this.reply(message);
      }

      return true;

    } catch (error) {
      logger.error('添加表情包错误:', error);
      await this.reply(`添加表情包失败:${error.message}`);
      return true;
    }
  }

  // 删除表情包命令
  async deleteEmoji(e) {
    try {
      const match = e.msg.match(/^#?删除表情包\s*(.+?)\s*(\d+)(?:\s*-\s*(\d+))?\s*$/);
      if (!match) {
        await this.reply('命令格式错误,请使用:删除表情包 <名称> <编号> 或 删除表情包 <名称> <起始编号>-<结束编号>');
        return true;
      }

      const emojiName = match[1].trim();
      const startNumber = parseInt(match[2]);
      const endNumber = match[3] ? parseInt(match[3]) : startNumber;
      const folderPath = path.join(this.emojiPath, emojiName);

      if (!fs.existsSync(folderPath)) {
        await this.reply(`表情包分类${emojiName}不存在`);
        return true;
      }

      const files = fs.readdirSync(folderPath);
      const filesToDelete = files.filter(file => {
        const match = file.match(/^(\d+)\./);
        if (!match) return false;
        const fileNumber = parseInt(match[1]);
        return fileNumber >= startNumber && fileNumber <= endNumber;
      });

      if (filesToDelete.length === 0) {
        await this.reply(`未找到${emojiName}分类中编号为${startNumber}${endNumber !== startNumber ? `-${endNumber}` : ''}的图片`);
        return true;
      }

      filesToDelete.forEach(file => {
        fs.unlinkSync(path.join(folderPath, file));
      });

      // 检查是否删除了所有图片
      const remainingFiles = fs.readdirSync(folderPath).filter(file => /\.(jpg|jpeg|png|gif|webp)$/i.test(file));
      const hasTxtFile = fs.existsSync(path.join(folderPath, `${emojiName}.txt`));

      if (remainingFiles.length === 0 && !hasTxtFile) {
        // 删除空文件夹
        fs.rmdirSync(folderPath);
        await this.reply(`删除表情包 ${emojiName} ${startNumber}${endNumber !== startNumber ? `-${endNumber}` : ''} 成功, 且已删除空文件夹`);
      } else {
        await this.reply(`删除表情包 ${emojiName} ${startNumber}${endNumber !== startNumber ? `-${endNumber}` : ''} 成功`);
      }

      return true;

    } catch (error) {
      logger.error('删除表情包错误:', error);
      await this.reply(`删除表情包失败:${error.message}`);
      return true;
    }
  }

  // 查看表情包命令
  async viewEmoji(e) {
    try {
      const match = e.msg.match(/^#?查看表情包 *(.+)$/);
      if (!match) {
        await this.reply('命令格式错误,请使用:查看表情包 <名称>');
        return true;
      }

      const emojiName = match[1].trim();
      const folderPath = path.join(this.emojiPath, emojiName);

      if (!fs.existsSync(folderPath)) {
        await this.reply(`表情包分类${emojiName}不存在`);
        return true;
      }

      const files = fs.readdirSync(folderPath);

      if (files.length === 0) {
        await this.reply(`表情包${emojiName}中无任何文件`);
        return true;
      }

      const txtFile = files.find(file => file.toLowerCase() === `${emojiName.toLowerCase()}.txt`);
      let bilibiliTotalCount = 0;
      let bilibiliGifCount = 0;
      let bilibiliImageCount = 0;

      if (txtFile) {
        const txtFilePath = path.join(folderPath, txtFile);
        const content = fs.readFileSync(txtFilePath, 'utf8');
        const urls = content.match(/[^\r\n]+/g).map(url => url.trim()); // 使用正则表达式匹配非空行

        const validUrls = urls.map(this.adaptUrl.bind(this)).filter(url => url && url.startsWith('http'));

        bilibiliTotalCount = validUrls.length;
        bilibiliGifCount = validUrls.filter(url => url.toLowerCase().endsWith('.gif')).length;
        bilibiliImageCount = validUrls.filter(url => /\.(jpg|jpeg|png|webp)$/i.test(url)).length;
      }

      const localImages = files.filter(file => /\.(jpg|jpeg|png|gif|webp)$/i.test(file));
      let localTotalCount = 0;
      let localGifCount = 0;
      let localImageCount = 0;

      localTotalCount = localImages.length;
      localGifCount = localImages.filter(file => file.toLowerCase().endsWith('.gif')).length;
      localImageCount = localImages.filter(file => /\.(jpg|jpeg|png|webp)$/i.test(file)).length;

      const sortedFiles = files
        .filter(file => file.toLowerCase() !== `${emojiName.toLowerCase()}.txt`)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })); // 使用 localeCompare 进行排序
      const finalFiles = txtFile ? [txtFile, ...sortedFiles] : sortedFiles;

      let message = `${emojiName}表情包:\n`;
      if (bilibiliTotalCount > 0) {
        message += `哔哩哔哩表情包共${bilibiliTotalCount}张\n`;
        message += `gif为${bilibiliGifCount}张\n`;
        message += `图片为${bilibiliImageCount}张\n`;
      } else {
        message += `哔哩哔哩表情包为0张\n`;
      }

      if (localTotalCount > 0) {
        message += `本地表情包共${localTotalCount}张\n`;
        message += `gif为${localGifCount}张\n`;
        message += `图片为${localImageCount}张\n`;
      } else {
        message += `本地表情包为0张\n`;
      }

      message += `文件如下:\n`;
      finalFiles.forEach(file => {
        message += `${file}\n`;
      });

      await this.reply(await e.group.makeForwardMsg([
        {
          message: message.trim(),
          nickname: BOT_NICKNAME,
          user_id: BOT_id
        }
      ]));

      return true;
    } catch (error) {
      logger.error('查看表情包错误:', error);
      await this.reply(`查看表情包失败:${error.message}`);
      return true;
    }
  }

  // 切换表情包转发模式命令
  async toggleForwardMode(e) {
    this.forwardMode = this.forwardMode === 'multi' ? 'single' : 'multi';
    this.config.forwardMode = this.forwardMode;
    this.saveConfig();
    await this.reply(`表情包转发模式已切换为: ${this.forwardMode === 'multi' ? '多层转发' : '单层转发'}`);
    return true;
  }

  // 获取表情包
  async getImagesFromForwardMsg(e) {
    const imageUrls = [];

    if (e?.reply_id !== undefined) {
      try {
        const replyMsg = await e.getReply();
        //console.log('回复的原始消息:', JSON.stringify(replyMsg, null, 2));

        if (replyMsg && replyMsg.message) {
          if (e.bot.version?.app_name === 'NapCat.Onebot') {
            // NapCatQQ 协议端逻辑
            const extractImagesFromContent = (content) => {
              if (!content) return [];

              const images = [];
              for (let item of content) {
                // 处理普通的图片消息
                if (item.type === 'image' && item.data?.url) {
                  images.push(item.data.url);
                }

                if (Array.isArray(item.message)) {
                  for (let subItem of item.message) {
                    if (subItem.type === 'image' && subItem.data?.url) {
                      images.push(subItem.data.url);
                    }
                  }
                }

                // 递归处理嵌套的转发消息
                const forwardMsg = item.type === 'forward' ? item : (Array.isArray(item.message) ? item.message.find(m => m.type === 'forward') : null);

                if (forwardMsg) {
                  const nestedContent = forwardMsg.data?.content || forwardMsg.content;
                  if (nestedContent) {
                    images.push(...extractImagesFromContent(nestedContent));
                  }
                }
              }
              return images;
            };

            const forwardMsg = Array.isArray(replyMsg.message)
              ? replyMsg.message.find(msg => msg.type === 'forward')
              : (replyMsg.type === 'forward' ? replyMsg : null);

            if (forwardMsg) {
              const content = forwardMsg.data?.content || forwardMsg.content;
              //console.log('转发消息内容:', JSON.stringify(forwardMsg, null, 2));

              if (content) {
                imageUrls.push(...extractImagesFromContent(content));
              }
            }

          } else {
            // 非 NapCatQQ 协议端逻辑
            const extractImagesRecursive = async (content) => {
              if (!content) return [];
              let images = [];
              const contentArray = Array.isArray(content) ? content : [content];

              for (let item of contentArray) {
                if (item.type === 'image' && item.data?.url) {
                  images.push(item.data.url);
                }
                if (item.type === 'forward') {
                  const forwardId = item.data?.id || item.id;
                  if (forwardId) {
                    try {
                      const forwardDetail = await e.bot.sendApi('get_forward_msg', { message_id: forwardId });
                      if (forwardDetail?.data?.messages && Array.isArray(forwardDetail.data.messages)) {
                        for (const msg of forwardDetail.data.messages) {
                          images.push(...await extractImagesRecursive(msg.content));
                        }
                      }
                    } catch (forwardError) {
                      logger.error(`获取转发消息详情失败 (ID: ${forwardId}): ${forwardError.message}`);
                    }
                  }
                }
              }
              return images;
            };

            // 调用异步函数处理整个回复消息
            imageUrls.push(...await extractImagesRecursive(replyMsg.message));
          }
        }
      } catch (error) {
        logger.error('获取回复消息失败:', error);
      }
    }

    if (imageUrls.length === 0) {
      await this.reply('未在转发消息中找到图片');
    }

    return imageUrls;
  }

  // 表情包帮助命令
  async helpEmoji(e) {
    const helpMessage = [
      '表情包功能使用帮助:',
      '1. 来张<表情包名> [本地|哔哩哔哩|b站] [gif|图片]- 发送一张指定表情包',
      '2. 来第<编号>-<编号>张<表情包名> [本地|哔哩哔哩|b站] - 发送指定编号或范围的表情包',
      '3. 再来一张 [本地|哔哩哔哩|b站] [gif|图片] - 重复发送上一个表情包',
      '4. 来<数字>张<表情包名> [本地|哔哩哔哩|b站] [gif|图片]- 发送多张指定表情包(默认最多100张)',
      '5. 来张随机 [本地|哔哩哔哩|b站] [gif|图片]- 发送一张随机表情包',
      '6. 来<数字>张随机 [本地|哔哩哔哩|b站] [gif|图片]- 发送多张随机表情包(默认最多100张)',
      '7. 表情包列表 - 查看所有可用表情包',
      '8. 添加表情包 <名称> - 添加新的表情包',
      '9. 删除表情包 <名称> <编号>-<编号> - 删除指定编号或范围的表情',
      '10. 查看表情包 <名称> - 查看指定表情包的文件列表',
      '11. 切换表情包转发模式 - 切换多张表情包的发送方式 (多层转发/单层转发，默认多层转发)',
      '12. 表情包帮助 - 查看此帮助信息',
      '注: [本地|哔哩哔哩|b站] [gif|图片] 参数可以组合使用，例如 "来张xxx 本地" 或 "来张xxx b站 gif" 非NapCatQQ请使用单层转发'
    ];

    await this.reply(helpMessage.join('\n'));
    return true;
  }
}

