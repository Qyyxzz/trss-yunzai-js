// 本插件出自https://www.npmjs.com/package/koishi-plugin-baidu-image-search?activeTab=readme koishi-plugin-baidu-image-search

import fs from 'fs';
import path from 'path';

// 定义多语言文本
const i18n = {
  "zh-CN": {
    commands: {
      "百度搜图": {
        api: 'baidu',
        backupApi: 'baidu_backup',
        messages: {
          "expect_text": "请输入要搜索的关键词。",
          "search_nullresult": "搜索不到哦~",
          "search_failed": "图片获取失败，请稍后重试。",
          "search_backup": "接口错误。尝试备用接口搜索......"
        }
      },
      "搜狗搜图": {
        api: 'sogou',
        messages: {
          "expect_text": "请输入要搜索的关键词。",
          "search_nullresult": "搜索不到哦~",
          "search_failed": "图片获取失败，请稍后重试。"
        }
      },
      "堆糖搜图": {
        api: 'duitang',
        messages: {
          "expect_text": "请输入要搜索的关键词。",
          "search_nullresult": "搜索不到哦~",
          "search_failed": "图片获取失败，请稍后重试。"
        }
      }
    }
  }
};

// 默认配置
const defaultConfig = {
  logModeChangeAPI: false,
  apiUrls: {
    baidu: 'https://api.suyanw.cn/api/baidu_image_search.php?type=json&msg=',
    baidu_backup: 'https://api.52vmy.cn/api/img/baidu?msg=',
    sogou: 'https://api.lolimi.cn/API/sgst/api.php?msg=',
    duitang: 'https://api.suyanw.cn/api/duitang.php?msg='
  }
};

export class ImageSearch extends plugin {
  constructor() {
    super({
      name: 'image-search',
      dsc: '图片搜索',
      event: 'message',
      priority: 5000,
      rule: [
        {
          reg: /^(百度|搜狗|堆糖)搜图\s+(.*)$/,
          fnc: 'imageSearch',
        },
      ],
    });

    // 获取配置
    this.config = { ...defaultConfig, ...(this.cfg || {}) };
  }

  async imageSearch(e) {
    const match = e.msg.match(/^(百度|搜狗|堆糖)搜图\s+(.*)$/);
    if (!match) {
      return;
    }
    const [searchEngine, keyword] = [match[1], match[2]];
    const commandKey = `${searchEngine}搜图`;
    const command = i18n["zh-CN"].commands[commandKey];

    if (!keyword) {
      await e.reply(command.messages.expect_text);
      return;
    }

    const apiUrl = this.config.apiUrls[command.api] + encodeURIComponent(keyword);

    try {
      if (command.api === 'baidu') {
        await this.handleBaiduSearch(e, keyword, command, apiUrl);
      } else {
        // 将 keyword 传递给 handleCommonSearch 函数
        await this.handleCommonSearch(e, keyword, command, apiUrl);
      }
    } catch (error) {
      logger.error(`Error with ${searchEngine} API:`, error);
      await e.reply(command.messages.search_failed);
    }
  }

  async handleBaiduSearch(e, keyword, command, apiUrl) {
    try {
      const response = await fetch(apiUrl);
      const data = await response.json();

      if (response.ok && data.code === 1 && data.data && data.data.length > 0) {
        const imageUrl = data.data[Math.floor(Math.random() * data.data.length)].imageurl;

        // 下载图片到 data/image temp 目录
        const imagePath = await this.downloadImage(imageUrl, keyword);

        if (imagePath) {
          // 使用本地文件路径发送图片
          await e.reply(segment.image(`${imagePath}`));
          // 发送完后删除临时图片
          fs.unlinkSync(imagePath);
        } else {
          throw new Error('Image download failed');
        }
      } else {
        if (this.config.logModeChangeAPI) {
          logger.error('目标地址url:  ', apiUrl);
          logger.error('Error with default API:  ', data);
          logger.error(command.messages.search_backup);
        }
        await this.tryBackupApi(e, keyword, command);
      }
    } catch (error) {
      if (this.config.logModeChangeAPI) {
        logger.error('Error with default API:  ', error);
        logger.error(command.messages.search_backup);
      }
      await this.tryBackupApi(e, keyword, command);
    }
  }

  async tryBackupApi(e, keyword, command) {
    const backupApiUrl = this.config.apiUrls[command.backupApi] + encodeURIComponent(keyword);

    try {
      const response = await fetch(backupApiUrl);
      const data = await response.json();

      if (response.ok && data.code === 200) {
        // 下载图片到 data/image temp 目录
        const imagePath = await this.downloadImage(data.data.url, keyword);

        if (imagePath) {
          // 使用本地文件路径发送图片
          await e.reply(segment.image(`${imagePath}`));
          // 发送完后删除临时图片
          fs.unlinkSync(imagePath);
        } else {
          throw new Error('Image download failed');
        }
      } else if (response.ok && data.code === 201) {
        await e.reply(command.messages.search_nullresult);
      } else {
        throw new Error('Backup API error');
      }
    } catch (error) {
      if (this.config.logModeChangeAPI) {
        logger.error('Error with backup API:', error);
      }
      await e.reply(command.messages.search_failed);
    }
  }

  async handleCommonSearch(e, keyword, command, apiUrl) { // 添加 keyword 参数
    try {
      const response = await fetch(apiUrl);
      let imageUrl;

      if (command.api === 'duitang') {
        // 只使用 response.text() 获取响应内容
        const text = await response.text();
        if (this.config.logModeChangeAPI) {
          logger.info('API response:', text);
        }
        const match = text.match(/"images":\s*"([^"]+)"/);
        if (match && match[1]) {
          imageUrl = match[1];
        } else {
          await e.reply(command.messages.search_nullresult);
          return;
        }
      } else if (command.api === 'sogou') {
        // 对于搜狗，仍然使用 response.json()
        const data = await response.json();
        if (response.ok && data.code === 1 && data.data) {
          imageUrl = data.data.url;
        } else {
          await e.reply(command.messages.search_failed);
          return;
        }
      } else {
        await e.reply(command.messages.search_failed);
        return;
      }

      // 现在可以正确使用 keyword 了
      const imagePath = await this.downloadImage(imageUrl, keyword);

      if (imagePath) {
        // 使用本地文件路径发送图片
        await e.reply(segment.image(`${imagePath}`));
        // 发送完后删除临时图片
        fs.unlinkSync(imagePath);
      } else {
        throw new Error('Image download failed');
      }
    } catch (error) {
      logger.error('Error with API:', error);
      await e.reply(command.messages.search_failed);
    }
  }

  // 下载图片到 data/image temp 目录
  async downloadImage(imageUrl, keyword) {
    try {
      const response = await fetch(imageUrl);
      if (!response.ok) {
        logger.error(`Failed to download image: ${imageUrl}, status: ${response.status}`);
        return null;
      }

      // 使用时间戳和关键词生成唯一的文件名
      const timestamp = new Date().getTime();
      const filename = `${keyword}_${timestamp}.jpg`;
      const imagePath = path.join(process.cwd(), 'data', 'image temp', filename);

      // 确保 data/image temp 目录存在
      const dir = path.dirname(imagePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const buffer = await response.arrayBuffer();
      fs.writeFileSync(imagePath, Buffer.from(buffer));

      return imagePath;
    } catch (error) {
      logger.error(`Error downloading image: ${imageUrl}`, error);
      return null;
    }
  }
}
