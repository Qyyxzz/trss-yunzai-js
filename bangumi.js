import plugin from '../../lib/plugins/plugin.js';
import fetch from 'node-fetch';

// 在此处填写你的 Bangumi Access Token, 获取地址: https://next.bgm.tv/demo/access-token
// [可选] 为空则以游客模式请求，可能无法获取部分数据(nsfw)
const ACCESS_TOKEN = '';

// NSFW (R18) 内容的撤回延迟时间（秒），设置为 0 则不撤回
const RECALL_DELAY_SECONDS = 60;

// 最大搜索结果数量
const MAX_SEARCH_RESULTS = 5;

const typeMap = {
  1: '书籍',
  2: '动画',
  3: '音乐',
  4: '游戏',
  6: '三次元'
};

export class BangumiQuery extends plugin {
  constructor() {
    super({
      name: 'Bangumi查询',
      dsc: '从Bangumi查询游戏、动画等信息',
      event: 'message',
      priority: 5000,
      rule: [
        {
          reg: '^#bg查询\\s+.+$',
          fnc: 'searchKeyword'
        },
        {
          reg: '^#bg帮助$',
          fnc: 'showHelp'
        }
      ]
    });
  }

  async showHelp(e) {
    const helpMsg = [
      '--- Bangumi查询 帮助 ---',
      '#bg查询 <关键词> [类型]',
      '说明：',
      '  ▫ <关键词>: 你想搜索的内容',
      '  ▫ [类型]: 可选参数，指定搜索的分类',
      '    1: 书籍',
      '    2: 动画',
      '    3: 音乐',
      '    4: 游戏 (默认)',
      '    6: 三次元',
      '示例：',
      '  ▫ #bg查询 赛博朋克',
      '  ▫ #bg查询 CLANNAD 2',
      '  ▫ #bg查询 CLANNAD 4',
    ].join('\n');
    await e.reply(helpMsg, true);
    return true;
  }

  async searchKeyword(e) {
    const match = e.msg.match(/^#bg查询\s+(.+?)(?:\s+([12346]))?$/);
    if (!match) {
      await this.showHelp(e);
      return true;
    }

    const keyword = match[1].trim();
    const type = match[2] || '4';
    const typeName = typeMap[type];
    const tipMsg = await e.reply(`⏳ 正在从 Bangumi 的「${typeName}」分类中搜索“${keyword}”，请稍候...`, true);
    const tipMsgId = tipMsg?.message_id;

    try {
      const searchApiUrl = `https://api.bgm.tv/search/subject/${encodeURIComponent(keyword)}?type=${type}`;
      const searchResponse = await fetch(searchApiUrl);

      if (!searchResponse.ok) {
        await e.reply(`❌ Bangumi 搜索接口请求失败 [HTTP ${searchResponse.status}]`, true);
        return true;
      }

      const searchData = await searchResponse.json();
      if (!searchData.list || searchData.list.length === 0) {
        await e.reply(`🔍 未在 Bangumi 的「${typeName}」分类中找到与“${keyword}”相关的条目`, true);
        return true;
      }

      const resultsToFetch = searchData.list.slice(0, MAX_SEARCH_RESULTS);
      const messageNodes = [];
      let anyNsfw = false;

      for (const item of resultsToFetch) {
        const detailResult = await this.getFormattedSubjectDetailMarkdown(item.id, e);
        if (detailResult && detailResult.markdown) {
          messageNodes.push({
            type: 'node',
            data: {
              nickname: this.e.sender.card || this.e.sender.nickname,
              user_id: this.e.user_id,
              content: [{
                type: 'markdown',
                data: { content: detailResult.markdown }
              }]
            }
          });
          if (detailResult.isNsfw) {
            anyNsfw = true;
          }
        }
      }

      if (messageNodes.length > 0) {
        await this.sendForwardedMsg(e, messageNodes, anyNsfw, tipMsgId);
      } else {
        await e.reply('❌ 未能获取到任何条目的详细信息，可能是 Access Token 无效或网络问题。', true);
      }

    } catch (err) {
      logger.error(`[Bangumi查询] 搜索 "${keyword}" (类型:${type}) 时发生异常:`, err);
      await e.reply('⚠️ 搜索失败，请检查网络或稍后重试', true);
    }
    return true;
  }
  
  async fetchWithToken(url) {
    const headers = {};
    if (ACCESS_TOKEN) {
      headers['Authorization'] = `Bearer ${ACCESS_TOKEN}`;
    }
    return fetch(url, { headers });
  }

  async getFormattedSubjectDetailMarkdown(subjectId, e) {
    try {
      const [subjectRes, personsRes, charactersRes, relationsRes] = await Promise.all([
        this.fetchWithToken(`https://api.bgm.tv/v0/subjects/${subjectId}`),
        this.fetchWithToken(`https://api.bgm.tv/v0/subjects/${subjectId}/persons`),
        this.fetchWithToken(`https://api.bgm.tv/v0/subjects/${subjectId}/characters`),
        this.fetchWithToken(`https://api.bgm.tv/v0/subjects/${subjectId}/subjects`)
      ]);

      if (!subjectRes.ok) {
        logger.error(`[Bangumi查询] 主条目详情接口请求失败 [HTTP ${subjectRes.status}] for ID ${subjectId}`);
        return null;
      }
      const data = await subjectRes.json();

      const name = data.name_cn ? `${data.name_cn} (${data.name})` : data.name;
      const score = data.rating?.score ? `${data.rating.score} / 10` : '暂无评分';
      const scoreCount = data.rating?.total ? `(${data.rating.total}人评分)` : '';
      const rank = data.rating?.rank ? `No.${data.rating.rank}` : '无排名';
      const coverUrl = data.images?.large || '';
      
      const infobox = new Map(data.infobox?.map(item => [item.key, item.value]) || []);
      
      const getInfo = (keys) => {
        for (const key of keys) {
          if (infobox.has(key)) {
            const value = infobox.get(key);
            if (Array.isArray(value)) {
              return value.map(item => {
                if (typeof item === 'object' && item !== null) {
                  if (item.k && item.v) return `${item.k}: ${item.v}`;
                  if (item.v) return item.v;
                }
                return item;
              }).join(' / ');
            }
            return value;
          }
        }
        return '无';
      };

      const releaseDate = getInfo(['发行日期', '发售日期', '放送开始']);
      const alias = getInfo(['别名']);
      const websiteValue = infobox.get('官方网站') || infobox.get('website');
      let websiteLinks = '';
      if (websiteValue) {
        const linksArray = Array.isArray(websiteValue) ? websiteValue : [{ v: websiteValue }];
        websiteLinks = linksArray.map(item => {
          const linkText = (typeof item === 'object' ? item.v : item);
          const urlIndex = linkText.indexOf('http');
          if (urlIndex > 0) {
            let label = linkText.substring(0, urlIndex).trim().replace(/[:：\s]+$/, '');
            const url = linkText.substring(urlIndex).trim();
            return `[${label}](${url})`;
          } else {
            return `[官网](${linkText})`;
          }
        }).join(' | ');
      }
      const websiteDisplay = websiteLinks ? ` | ${websiteLinks}` : '';

            const tags = data.tags && data.tags.length > 0
        ? data.tags
            .sort((a, b) => b.count - a.count)
            .slice(0, 20) // 前二十个标签
            .map(t => t.name)
            .join('，')
        : '无';
      
      let ageRating = getInfo(['R-指定', '年龄限制', '分级']);
      if (ageRating === '无') {
        ageRating = data.nsfw ? 'R-18' : '全年龄';
      }

      const summary = data.summary?.replace(/(\r\n|\n|\r)/gm, '\n') || '暂无简介';
      const collection = data.collection ? `想看: ${data.collection.wish} | 看过: ${data.collection.collect} | 在看: ${data.collection.doing} | 搁置: ${data.collection.on_hold} | 抛弃: ${data.collection.dropped}` : '无';

      let specificInfo = [];
      if (alias !== '无') specificInfo.push(`**别名：** ${alias}`);

      switch (data.type) {
        case 1: // 书籍
          specificInfo.push(`**作者：** ${getInfo(['作者', '原作'])}`);
          specificInfo.push(`**出版社：** ${getInfo(['出版社'])}`);
          specificInfo.push(`**连载杂志：** ${getInfo(['连载杂志'])}`);
          specificInfo.push(`**册数：** ${getInfo(['册数'])}`);
          break;
        case 2: // 动画
          specificInfo.push(`**话数：** ${getInfo(['话数'])}`);
          specificInfo.push(`**动画制作：** ${getInfo(['制作', '製作'])}`);
          specificInfo.push(`**原作：** ${getInfo(['原作'])}`);
          break;
        case 3: // 音乐
          specificInfo.push(`**艺术家：** ${getInfo(['艺术家', '歌手'])}`);
          specificInfo.push(`**作曲：** ${getInfo(['作曲'])}`);
          specificInfo.push(`**作词：** ${getInfo(['作词'])}`);
          specificInfo.push(`**编曲：** ${getInfo(['编曲'])}`);
          specificInfo.push(`**价格：** ${getInfo(['价格', '售价'])}`);
          break;
        case 4: // 游戏
          specificInfo.push(`**开发：** ${getInfo(['开发', '制作', '开发商'])}`);
          specificInfo.push(`**发行：** ${getInfo(['发行', '发行商'])}`);
          specificInfo.push(`**出版：** ${getInfo(['出版', '出版商'])}`);
          specificInfo.push(`**平台：** ${getInfo(['平台'])}`);
          specificInfo.push(`**游戏类型：** ${getInfo(['游戏类型'])}`);
          specificInfo.push(`**游戏引擎：** ${getInfo(['游戏引擎'])}`);
          specificInfo.push(`**剧本：** ${getInfo(['剧本'])}`);
          specificInfo.push(`**售价：** ${getInfo(['售价'])}`);
          specificInfo.push(`**其他版本：** ${getInfo(['其他版本'])}`);
          break;
        case 6: // 三次元
          specificInfo.push(`**导演：** ${getInfo(['导演'])}`);
          specificInfo.push(`**主演：** ${getInfo(['主演', '演员'])}`);
          specificInfo.push(`**国家/地区：** ${getInfo(['国家/地区'])}`);
          break;
      }
      let staffAndCast = await this.getStaffAndCast(personsRes, charactersRes, data.type);
      let relationsText = '';
      if (relationsRes.ok) {
          const relations = await relationsRes.json();
          if (relations.length > 0) {
              relationsText = `## 🔗 关联条目\n` + relations.map(r => `**${r.relation}**: ${r.name_cn || r.name}`).join('\n');
          }
      }
      
      const msgList = [
        `![封面 #710px #960px](${coverUrl})`,
        `# ${name}`,
        '***',
        `**⭐ 评分：** ${score} ${scoreCount}`,
        `**📈 排名：** ${rank}`,
        `**📅 日期：** ${releaseDate}`,
        ...specificInfo,
        `**🔞 分级：** ${ageRating}`,
        `**🔗 链接：** [Bangumi](https://bgm.tv/subject/${data.id})${websiteDisplay}`,
        '***',
        `## 📊 收藏概览`,
        collection,
        ...(staffAndCast ? ['***', staffAndCast] : []),
        ...(relationsText ? ['***', relationsText] : []),
        '***',
        `## 🔖 标签`,
        tags,
        '***',
        `## 📖 简介`,
        '',
        summary
      ];

      return {
        markdown: msgList.join('\n'),
        isNsfw: data.nsfw
      };

    } catch (err) {
      logger.error(`[Bangumi查询] 获取ID ${subjectId} 详情时发生异常:`, err);
      return null;
    }
  }

  async getStaffAndCast(personsRes, charactersRes, subjectType) {
    let staffText = '';
    let castText = '';
    let staffTitle = '## 🎭 Staff'; // 默认标题

    if (personsRes.ok) {
        const persons = await personsRes.json();
        let mainStaff = [];
        switch(subjectType) {
            case 2: // 动画
                staffTitle = '## 🎬 Staff';
                mainStaff = persons.filter(p => ['导演', '脚本', '音乐', '人物设定', '系列构成', '总作画监督', '美术监督'].includes(p.relation)).slice(0, 7);
                break;
            case 4: // 游戏
                staffTitle = '## 🎨 Staff';
                mainStaff = persons.filter(p => ['原画', '剧本', '音乐', '主题歌演出', '主题歌作词', '主题歌作曲'].includes(p.relation)).slice(0, 7);
                break;
            default:
                mainStaff = persons.slice(0, 5);
        }
        if (mainStaff.length > 0) {
            staffText = `${staffTitle}\n${mainStaff.map(p => `**${p.relation}**: ${p.name}`).join('\n')}`;
        }
    }

    if (charactersRes.ok) {
        const characters = await charactersRes.json();
        const mainCast = characters.slice(0, 5);
        if (mainCast.length > 0) {
            castText = `## 🗣️ Cast\n${mainCast.map(c => `**${c.name}**: ${c.actors?.[0]?.name || '无'}`).join('\n')}`;
        }
    }

    if (staffText && castText) {
        return `${staffText}\n***\n${castText}`;
    }
    return staffText || castText || null;
  }

  async sendForwardedMsg(e, messages, isNsfw, tipMsgId = null) {
    const forwardMsg = {
      type: 'node',
      data: {
        nickname: e.sender.card || e.sender.nickname,
        user_id: e.user_id,
        content: messages
      }
    };

    let sentResult = null;
    try {
      if (e.isGroup) {
        sentResult = await e.bot.sendApi("send_group_forward_msg", {
          group_id: e.group_id,
          messages: [forwardMsg]
        });
      } else {
        sentResult = await e.bot.sendApi("send_private_forward_msg", {
          user_id: e.user_id,
          messages: [forwardMsg]
        });
      }

      if (isNsfw && RECALL_DELAY_SECONDS > 0) {
        setTimeout(async () => {
          try {
            if (e.isGroup) {
              if (sentResult?.message_id) {
                await e.group.recallMsg(sentResult.message_id);
              }
              if (tipMsgId) {
                await e.group.recallMsg(tipMsgId);
              }
            }
          } catch (recallError) {
            logger.error(`[Bangumi查询] 自动撤回NSFW消息失败:`, recallError);
          }
        }, RECALL_DELAY_SECONDS * 1000);
      }
    } catch (err) {
      logger.error('[Bangumi查询] 发送合并转发消息异常:', err);
      await e.reply('⚠️ 发送结果失败，可能是机器人被风控或禁言了');
    }
  }
}
