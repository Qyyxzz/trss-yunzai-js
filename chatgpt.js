import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { segment } from 'oicq';
import plugin from '../../lib/plugins/plugin.js';

const configPath = path.join('./plugins/example/chatgpt.json');

// 存储对话
const chatConversationHistory = {};  // 用于 chat 功能的对话历史
const drawConversationHistory = {};  // 用于 draw 功能的对话历史

// 扩展estimateTokensAdvanced函数
function estimateTokensAdvanced(text) {
  if (!text) return 0;

  const words = text.split(/\s+/);
  let tokenCount = 0;

  for (const word of words) {
    // 空字符串跳过
    if (!word) continue;

    // 英文单词（包括带标点符号的情况）
    if (/^[a-zA-Z]+[.,!?;:'"]*$/.test(word)) {
      tokenCount += 1;
      // 如果单词很长，可能会被分成多个token
      if (word.length > 8) {
        tokenCount += Math.floor(word.length / 8);
      }
    }
    // 数字（包括小数和负数）
    else if (/^-?\d*\.?\d+$/.test(word)) {
      tokenCount += Math.ceil(word.length / 2);
    }
    // 表情符号
    else if (/[\u{1F300}-\u{1F9FF}]/u.test(word)) {
      tokenCount += word.length * 2;
    }
    // 中文字符
    else {
      const chineseChars = word.match(/[\u4e00-\u9fa5]/g) || [];
      const otherChars = word.length - chineseChars.length;

      // 中文字符算2个token
      tokenCount += chineseChars.length * 2;

      // 其他字符（标点符号等）算1个token
      tokenCount += otherChars;

      // 如果是很长的连续非中文字符，可能会被分成多个token
      if (otherChars > 8) {
        tokenCount += Math.floor(otherChars / 8);
      }
    }
  }

  // 考虑换行符和特殊字符
  const newlines = (text.match(/\n/g) || []).length;
  tokenCount += newlines;
  return tokenCount;
}

export class ChatGPT extends plugin {
  constructor() {
    super({
      name: 'ChatGPT',
      dsc: 'ChatGPT 对话',
      event: 'message',
      priority: 5000,
      rule: [
        {
          reg: '^(//|#/).*(绘图.*)$',
          fnc: 'draw'
        },
        {
          reg: '^(//|#/)((?!绘图).)*$',
          fnc: 'chat'
        },
        {
          reg: '^设置apiurl[1-8].*$',
          fnc: 'setApiUrl',
          permission: "master"
        },
        {
          reg: '^删除apiurl[1-8]$',
          fnc: 'deleteApiUrl',
          permission: "master"
        },
        {
          reg: '^设置geminikey.*$',
          fnc: 'setGeminiKey',
          permission: "master"
        },
        {
          reg: '^删除geminikey$',
          fnc: 'deleteGeminiKey',
          permission: "master"
        },
        {
          reg: '^设置apikey[1-8].*$',
          fnc: 'setApiKey',
          permission: "master"
        },
        {
          reg: '^删除apikey[1-8]$',
          fnc: 'deleteApiKey',
          permission: "master"
        },
        {
          reg: '^授权使用key$',
          fnc: 'authorizeGroup',
          permission: "master"
        },
        {
          reg: '^取消授权使用key$',
          fnc: 'unauthorizeGroup',
          permission: "master"
        },
        {
          reg: '^查看url$',
          fnc: 'viewUrlsAndKeys',
          permission: "master"
        },
        {
          reg: '^添加模型\\s*[^\\s]+.*$',
          fnc: 'addModel',
          permission: "master"
        },
        {
          reg: '^删除模型\\s*[^\\s]+$',
          fnc: 'deleteModel',
          permission: "master"
        },
        {
          reg: '^模型列表$',
          fnc: 'listModels'
        },
        {
          reg: '^当前模型$',
          fnc: 'currentModel'
        },
        {
          reg: '^切换模型.*$',
          fnc: 'switchModel',
          permission: "master"
        },
        {
          reg: '^默认模型$',
          fnc: 'defaultModel'
        },
        {
          reg: '^设置默认模型.*$',
          fnc: 'setDefaultModel',
          permission: "master"
        },
        {
          reg: '^添加绘图模型\\s*[^\\s]+$',
          fnc: 'addDrawModel',
          permission: "master"
        },
        {
          reg: '^删除绘图模型\\s*[^\\s]+$',
          fnc: 'deleteDrawModel',
          permission: "master"
        },
        {
          reg: '^绘图模型列表$',
          fnc: 'listDrawModels'
        },
        {
          reg: '^当前绘图模型$',
          fnc: 'currentDrawModel'
        },
        {
          reg: '^切换绘图模型.*$',
          fnc: 'switchDrawModel',
          permission: "master"
        },
        {
          reg: '^默认绘图模型$',
          fnc: 'defaultDrawModel'
        },
        {
          reg: '^设置默认绘图模型.*$',
          fnc: 'setDefaultDrawModel',
          permission: "master"
        },
        {
          reg: '^添加预设.*$',
          fnc: 'addPreset'
        },
        {
          reg: '^切换预设.*$',
          fnc: 'setPreset'
        },
        {
          reg: '^当前预设$',
          fnc: 'currentPreset'
        },
        {
          reg: '^查看预设.*$',
          fnc: 'viewPreset'
        },
        {
          reg: '^删除预设.*$',
          fnc: 'deletePreset'
        },
        {
          reg: '^预设列表$',
          fnc: 'listPresets'
        },
        {
          reg: '^设置上下文记忆.*$',
          fnc: 'setContextMemory'
        },
        {
          reg: '^清空对话$',
          fnc: 'clearContent'
        },
        {
          reg: '^chatgpt帮助$',
          fnc: 'showHelp'
        }
      ]
    });

    this.config = this.loadConfig();
  }

  loadConfig() {
    const defaultConfig = {
      geminiUrl: 'https://generativelanguage.googleapis.com',
      geminiKey: '',
      apiBaseUrl1: '',
      apiKey1: '',
      apiBaseUrl2: '',
      apiKey2: '',
      apiBaseUrl3: '',
      apiKey3: '',
      apiBaseUrl4: '',
      apiKey4: '',
      apiBaseUrl5: '',
      apiKey5: '',
      apiBaseUrl6: '',
      apiKey6: '',
      apiBaseUrl7: '',
      apiKey7: '',
      apiBaseUrl8: '',
      apiKey8: '',
      authorizedGroups: [],
      models: [],
      modelApiMap: {},
      drawModels: ["gemini-2.0-flash-exp"],
      groupCurrentDrawModels: {},
      groupDefaultDrawModels: {},
      groupCurrentModels: {},
      groupDefaultModels: {},
      presets: {},
      groupPresets: {},
      groupContextMemory: {},
    };

    if (fs.existsSync(configPath)) {
      const loadedConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return { ...defaultConfig, ...loadedConfig };
    }

    this.config = defaultConfig;
    this.saveConfig();
    return defaultConfig;
  }

  saveConfig() {
    const dirPath = path.dirname(configPath);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    fs.writeFileSync(configPath, JSON.stringify(this.config, null, 2));
  }

  // 辅助函数：提取文本中的链接及其前面的文本，以及“搜索结果来自：”之后的所有内容
  extractLinksAndText(text) {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const matches = [];
    let lastIndex = 0;
    let match;

    // 查找“搜索结果来自：”的位置
    const searchResultIndex = text.indexOf("搜索结果来自：");

    while ((match = urlRegex.exec(text)) !== null) {
      const link = match[0];
      const textBeforeLink = text.substring(lastIndex, match.index).trim();

      // 如果链接在“搜索结果来自：”之前，则提取
      if (searchResultIndex === -1 || match.index < searchResultIndex) {
        matches.push({ text: textBeforeLink, link });
      }

      lastIndex = urlRegex.lastIndex;
    }

    // 如果存在“搜索结果来自：”，提取其后的所有内容，包括链接
    if (searchResultIndex !== -1) {
      const textAfterSearchResult = text.substring(searchResultIndex).trim();
      matches.push({ text: textAfterSearchResult, link: "" });
    }

    return matches;
  }

  // 辅助函数：创建转发消息,将每个链接分开发送
  createForwardMsg(linksAndTexts, e) {
    let forwardMsg = [];

    for (const item of linksAndTexts) {
      if (item.text.startsWith("搜索结果来自：")) {
        const lines = item.text.split('\n');
        for (const line of lines) {
          if (line.trim()) {
            forwardMsg.push({
              message: line.trim(),
              nickname: e.sender.card || e.user_id,
              user_id: e.user_id,
            });
          }
        }
      } else {
        forwardMsg.push({
          message: item.link ? `${item.text}\n${item.link}` : item.text,
          nickname: e.sender.card || e.user_id,
          user_id: e.user_id,
        });
      }
    }

    return e.isGroup ? Bot.makeForwardMsg(forwardMsg) : forwardMsg;
  }

  async chat(e) {
    // 1. 基础检查
    if (!this.config.apiKey1 && !this.config.apiKey2 && !this.config.geminiKey) {
      e.reply('请先设置APIKey或GeminiKey');
      return true;
    }

    // 主人免授权判断
    if (!this.e.isMaster) {
      if (!this.config.authorizedGroups.includes(e.group_id) && e.group_id) {
        e.reply('该群未被授权使用key');
        return true;
      }
    }

    let content = e.msg.replace(/^(\/\/|#\/)/, '').trim();

    // 检查是否有引用回复
    if (e.message[0].type === 'reply') {
      try {
        const reply = await e.getReply(); // 使用try...catch包裹，避免报错
        if (reply) {
          const replyMsg = reply.message.find(item => item.text !== undefined);
          if (replyMsg?.text) {
            if (!content) {
              content = `翻译一下${replyMsg.text}`;
            } else {
              content = `${content}${replyMsg.text}`;
            }
          }
        }
      } catch (error) {
        logger.error("获取引用回复失败:", error);
      }
    }

    // 如果经过处理后仍然没有内容，给出提示
    if (!content) {
      e.reply('请输入对话内容');
      return true;
    }

    try {
      // 检查是否设置了模型
      const groupId = e.group_id || 'private';
      let currentModel = this.config.groupCurrentModels[groupId];

      // 如果没有设置当前模型，则尝试使用默认模型
      if (!currentModel) {
        currentModel = this.config.groupDefaultModels[groupId];
      }

      if (!currentModel) {
        e.reply('未设置AI模型，请先使用"切换模型"或"设置默认模型"命令配置模型');
        return true;
      }

      // 2. 准备对话历史
      const conversationKey = e.group_id || 'private';

      // 确保 conversationHistory 对象存在，并为特定会话键初始化数组
      if (!chatConversationHistory[conversationKey]) {
        chatConversationHistory[conversationKey] = [];
      }

      // 3. 处理预设
      const preset = await this.getGroupPreset(groupId);
      console.log(`预设名称: ${this.config.groupPresets[groupId]}, 预设内容: ${preset}`);

      // 如果预设存在且当前会话历史中没有系统消息，则添加预设
      if (preset && !chatConversationHistory[conversationKey].some(msg => msg.role === 'system')) {
        chatConversationHistory[conversationKey].unshift({ role: 'system', content: preset });
      }

      // 4. 添加用户消息
      chatConversationHistory[conversationKey].push({ role: 'user', content });

      // 5. 管理上下文长度
      // 使用群独立的上下文记忆设置
      const maxMessages = this.config.groupContextMemory[groupId] || this.config.contextMemory || 10;
      if (chatConversationHistory[conversationKey].length > maxMessages) {
        // 保留系统消息，清空其他对话历史
        chatConversationHistory[conversationKey] = chatConversationHistory[conversationKey].filter(msg => msg.role === 'system');
        // 添加当前用户消息
        chatConversationHistory[conversationKey].push({ role: 'user', content });
      }

      // 6. 准备发送消息
      const messagesToSend = [...chatConversationHistory[conversationKey]];
      console.log('对话历史:', JSON.stringify(chatConversationHistory[conversationKey], null, 2));

      // 7. 确定 API 配置
      const apiUrlKey = this.config.modelApiMap[currentModel] || 'apiBaseUrl1';
      let apiUrl, apiKey;

      if (apiUrlKey === 'geminiUrl') {
        apiUrl = this.config.geminiUrl;
        apiKey = this.config.geminiKey;
        console.log(`使用Gemini API`);
        console.log(`使用Gemini URL: ${apiUrl}`);
        console.log(`完整的Gemini URL: ${apiUrl}/v1beta/models/${currentModel}:generateContent`);
        console.log(`使用的Gemini模型: ${currentModel}`);
      } else {
        apiUrl = this.config[apiUrlKey];
        const apiKeyNum = apiUrlKey.replace('apiBaseUrl', 'apiKey');
        apiKey = this.config[apiKeyNum];
        console.log(`使用OpenAI兼容 API`);
        console.log(`使用OpenAI兼容 URL: ${apiUrl}`);
        console.log(`完整的OpenAI兼容 URL: ${apiUrl}/v1/chat/completions`);
        console.log(`使用的OpenAI兼容模型: ${currentModel}`);
      }

      if (apiKey) {
        console.log(`使用的 API 密钥: ${apiKey.substring(0, 5)}...${apiKey.substring(apiKey.length - 5)}`);
      } else {
        console.log('警告: API 密钥未设置');
      }

      // 8. 发送 API 请求
      let response;
      let aiResponse = null;
      let completion;
      let responseContent = null;

      if (apiUrlKey === 'geminiUrl') {
        // Gemini API 请求
        const geminiModel = currentModel.replace('', '');
        const fullUrl = `${apiUrl}/v1beta/models/${geminiModel}:generateContent`;
        try {
          response = await fetch(fullUrl, {
            method: 'POST',
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": apiKey,
            },
            body: JSON.stringify({
              contents: [{
                parts: messagesToSend.map(msg => ({
                  text: msg.content
                }))
              }],
              tools: [
                {
                  urlContext: {}
                },
                {
                  googleSearch: {}
                }
              ],
              generationConfig: {
                temperature: 0.7,
                topK: 40,
                topP: 0.95,
                maxOutputTokens: 8192,
                
                //thinkingConfig: {
                  //includeThoughts: true,
                  //thinkingBudget: 0,
                //},
              },
              safetySettings: []
            }),
          });

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP错误 ${response.status}: ${errorText}`);
          }

          completion = await response.json();
          console.log('Gemini API 响应:', JSON.stringify(completion, null, 2));

          let extractedText = '';
          if (completion.candidates && completion.candidates[0] && completion.candidates[0].content && completion.candidates[0].content.parts) {
            for (const part of completion.candidates[0].content.parts) {
              if (part.text) {
                extractedText += part.text;
              }
            }
          } else {
            throw new Error('Gemini API 响应格式不符合预期或内容为空');
          }
          if (!extractedText) {
            throw new Error('Gemini API 响应内容为空');
          }
          aiResponse = extractedText;
          responseContent = extractedText;

        } catch (error) {
          logger.error('Gemini API 请求错误:', error);
          throw error;
        }

      } else {
        // OpenAI兼容 API 请求
        response = await fetch(apiUrl + "/v1/chat/completions", {
          method: 'POST',
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json'
          },
          body: JSON.stringify({
            model: currentModel,
            messages: messagesToSend
          })
        });
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`HTTP错误 ${response.status}: ${errorText}`);
        }
        completion = await response.json();
        console.log('OpenAI兼容 API响应:', JSON.stringify(completion, null, 2));

        if (!completion.choices || !completion.choices[0] || !completion.choices[0].message) {
          throw new Error('OpenAI兼容 API响应格式不符合预期');
        }

        responseContent = completion.choices[0].message.content;
        let responseReasoning = completion.choices[0].message.reasoning_content;

        aiResponse = '';
        if (responseReasoning) {
          const trimmedReasoning = responseReasoning.trimEnd();
          aiResponse += `--- 思考开始 ---\n\n(${trimmedReasoning})\n\n--- 思考结束 ---\n\n\n`;
        }
        aiResponse += responseContent;
      }

      if (!aiResponse) {
        throw new Error('OpenAI兼容 API响应内容为空');
      }

      // 9. 更新对话历史
      if (responseContent !== null) {
        chatConversationHistory[conversationKey].push({
          role: 'assistant',
          content: responseContent
        });
      }

      // 10. 计算 token
      let tokenInfo = '';
      if (completion.usageMetadata) {
        // Gemini API 返回的 token 信息
        const { promptTokenCount, candidatesTokenCount, totalTokenCount } = completion.usageMetadata;
        tokenInfo = `本次token消耗: ${promptTokenCount}+${candidatesTokenCount}=${totalTokenCount}`;
      } else if (completion.usage &&
        typeof completion.usage.prompt_tokens === 'number' &&
        typeof completion.usage.completion_tokens === 'number' &&
        typeof completion.usage.total_tokens === 'number') {
        // OpenAI API 返回的 token 信息
        const { prompt_tokens, completion_tokens, total_tokens } = completion.usage;
        tokenInfo = `本次token消耗: ${prompt_tokens}+${completion_tokens}=${total_tokens}`;
      } else {
        // API 没有返回 token 信息，使用估算
        console.log('API未返回token信息，使用估算方法');
        const promptTokens = estimateTokensAdvanced(messagesToSend.map(msg => msg.content).join(' '));
        const completionTokens = responseContent ? estimateTokensAdvanced(responseContent) : 0;
        const totalTokens = promptTokens + completionTokens;
        tokenInfo = `本次消耗token(估): ${promptTokens}+${completionTokens}=${totalTokens}`;
      }

      // 11. 发送回复
      let aiResponseLines = aiResponse.split('\n');
      let searchResultLineIndex = aiResponseLines.findIndex(line => line.includes('搜索结果来自：'));

      let extractedContent = '';
      if (searchResultLineIndex !== -1) {
        extractedContent = aiResponseLines.slice(searchResultLineIndex).join('\n');
        aiResponseLines = aiResponseLines.slice(0, searchResultLineIndex);
      }

      let replyMsg = [segment.reply(e.message_id)];
      const responseWithoutExtractedContent = aiResponseLines.join('\n').trim();

      if (responseWithoutExtractedContent) {
        replyMsg.push(responseWithoutExtractedContent + '\n' + tokenInfo);
      }
      await e.reply(replyMsg);

      if (apiUrlKey === 'geminiUrl' && completion.candidates?.[0]?.groundingMetadata?.groundingChunks) {
        const searchChunks = completion.candidates[0].groundingMetadata.groundingChunks;
        const searchChunksRes = searchChunks.map(item => {
          const web = item.web;
          return {
            message: { type: "text", text: `📌 网站：${web.title}\n🌍 来源：${web.uri}` || "" },
            nickname: e.sender.card || e.user_id,
            user_id: e.user_id,
          };
        });
        if (searchChunksRes.length > 0) {
          await e.reply(Bot.makeForwardMsg(searchChunksRes));
        }
      } else if (apiUrlKey === 'geminiUrl' && completion.candidates?.[0]?.url_context_metadata?.url_metadata) {
        const urlContextMetadata = completion.candidates[0].url_context_metadata.url_metadata;
        const urlContextMessages = urlContextMetadata.map(item => {
          return {
            message: { type: "text", text: `🔗 URL: ${item.retrieved_url}\n状态: ${item.url_retrieval_status}` || "" },
            nickname: e.sender.card || e.user_id,
            user_id: e.user_id,
          };
        });
        if (urlContextMessages.length > 0) {
          await e.reply(Bot.makeForwardMsg(urlContextMessages));
        }

      } else if (extractedContent) {
        const extractedContentMessages = this.createForwardMsg([{ text: extractedContent, link: '' }], e);
        if (e.isGroup) {
          await e.reply(extractedContentMessages);
        } else {
          let privateReplyMessages = [];
          for (const msg of extractedContentMessages) {
            if (typeof msg.message === 'string') {
              privateReplyMessages.push(msg.message);
            } else if (Array.isArray(msg.message)) {
              privateReplyMessages.push(...msg.message);
            }
          }
          await e.reply(privateReplyMessages.join('\n'));
        }
      }
      return true;

    } catch (error) {
      logger.error('Chat方法错误:', error);

      let errorMessage = '对话失败: ';
      if (error.response) {
        errorMessage += `API错误 (${error.response.status}): ${error.response.statusText}`;
      } else if (error.message) {
        errorMessage += error.message;
      } else {
        errorMessage += '未知错误，请稍后重试';
      }

      await e.reply(errorMessage);
      return false;
    }
  }

  async draw(e) {
    // 1. 基础检查
    if (!this.config.apiKey1 && !this.config.apiKey2 && !this.config.geminiKey) {
      e.reply('请先设置APIKey或GeminiKey');
      return true;
    }
    // 主人免授权判断
    if (!this.e.isMaster) {
      if (!this.config.authorizedGroups.includes(e.group_id) && e.group_id) {
        e.reply('该群未被授权使用key');
        return true;
      }
    }

    // 2. 确定绘图模型
    const groupId = e.group_id || 'private';
    let currentDrawModel = this.config.groupCurrentDrawModels[groupId] || this.config.groupDefaultDrawModels[groupId] || "gemini-2.0-flash-exp";

    if (!this.config.drawModels.includes(currentDrawModel)) {
      logger.warn(`群组 ${groupId} 设置的绘图模型 ${currentDrawModel} 无效，回退到默认模型 gemini-2.0-flash-exp`);
      currentDrawModel = "gemini-2.0-flash-exp";
    }

    console.log(`当前绘图模型: ${currentDrawModel}`);

    // 3. 提取绘图提示词、用户图片和引用图片
    let content = e.msg.replace(/^(\/\/|#\/)/, '').trim();
    let prompt = content.replace(/绘图/, '').trim();
    let userImageBase64 = null;
    let replyImageBase64 = null;
    let isReply = false;
    let aiImageData = null;

    const imageSegment = e.message.find(item => item.type === 'image');
    if (imageSegment) {
      try {
        const response = await axios.get(imageSegment.url, { responseType: 'arraybuffer' });
        userImageBase64 = Buffer.from(response.data, 'binary').toString('base64');
      } catch (error) {
        logger.error('获取图片数据失败:', error);
        let errorMessage = '获取图片数据失败: ';
        if (error.response) {
          errorMessage += `API错误 (${error.response.status}): ${error.response.statusText}`;
        } else if (error.message) {
          errorMessage += error.message;
        } else {
          errorMessage += '未知错误';
        }
        e.reply(errorMessage);
        return true;
      }
    }

    if (e.message[0]?.type === 'reply') {
      isReply = true;
      try {
        const reply = await e.getReply();
        if (reply) {
          const replyImage = reply.message.find(item => item.type === 'image');
          if (replyImage) {
            const response = await axios.get(replyImage.url, { responseType: 'arraybuffer' });
            replyImageBase64 = Buffer.from(response.data, 'binary').toString('base64');
          }
        }
      } catch (error) {
        logger.error("获取引用回复失败:", error);
        let errorMessage = '获取引用回复失败: ';
        if (error.response) {
          errorMessage += `API错误 (${error.response.status}): ${error.response.statusText}`;
        } else if (error.message) {
          errorMessage += error.message;
        } else {
          errorMessage += '未知错误';
        }
        e.reply(errorMessage);
        return true;
      }
    }

    if (!prompt && (userImageBase64 || replyImageBase64)) {
      e.reply('请输入绘图提示词');
      return true;
    }
    if (!prompt && !userImageBase64 && !replyImageBase64) {
      e.reply('请输入绘图提示词');
      return true;
    }

    try {
      // 4. 准备对话历史
      const conversationKey = e.group_id || 'private';
      if (!drawConversationHistory[conversationKey]) {
        drawConversationHistory[conversationKey] = [];
      }

      // 5. 添加用户消息
      let userMessage = { role: 'user', parts: [] };
      if (isReply && replyImageBase64) {
        userMessage.parts.push({ inlineData: { mimeType: 'image/png', data: replyImageBase64 } });
        if (prompt) {
          userMessage.parts.push({ text: prompt });
        }
      } else {
        if (prompt) {
          userMessage.parts.push({ text: prompt });
        }
        if (userImageBase64) {
          userMessage.parts.push({ inlineData: { mimeType: 'image/png', data: userImageBase64 } });
        }
      }
      drawConversationHistory[conversationKey].push(userMessage);

      // 6. 管理上下文长度
      const maxMessages = this.config.groupContextMemory[groupId] || this.config.contextMemory || 10;
      if (drawConversationHistory[conversationKey].length > maxMessages) {
        drawConversationHistory[conversationKey] = drawConversationHistory[conversationKey].filter(msg => msg.role === 'system');
        drawConversationHistory[conversationKey].push(userMessage);
      }

      // 7. 准备发送消息
      const messagesToSend = [];
      for (const msg of drawConversationHistory[conversationKey]) {
        if (msg.role === 'system') {
          messagesToSend.push({ role: 'system', parts: [{ text: msg.content }] });
        } else if (msg.role === 'user') {
          const parts = [];
          for (const part of msg.parts) {
            if (part.text) {
              parts.push({ text: part.text });
            } else if (part.inlineData) {
              parts.push({ inlineData: part.inlineData });
            }
          }
          messagesToSend.push({ role: 'user', parts: parts });
        } else if (msg.role === 'assistant') {
          const parts = [];
          if (msg.parts) {
            for (const part of msg.parts) {
              if (part.text) {
                parts.push({ text: part.text });
              } else if (part.inlineData) {
                parts.push({ inlineData: part.inlineData });
              }
            }
          }
          messagesToSend.push({ role: 'model', parts: parts });
        }
      }

      const logMessages = messagesToSend.map(msg => {
        const logMsg = { ...msg, parts: [] };
        for (const part of msg.parts) {
          if (part.text) {
            logMsg.parts.push({ text: part.text });
          } else if (part.inlineData) {
            logMsg.parts.push({ image: '[图片]' });
          }
        }
        return logMsg;
      });
      console.log('对话历史:', JSON.stringify(logMessages, null, 2));

      // 8. 确定 API 配置
      const apiUrl = this.config.geminiUrl;
      const apiKey = this.config.geminiKey;
      console.log(`使用Gemini API进行绘图`);
      console.log(`使用Gemini URL: ${apiUrl}`);
      console.log(`完整的Gemini URL: ${apiUrl}/v1beta/models/${currentDrawModel}:generateContent`);
      console.log(`使用的Gemini模型: ${currentDrawModel}`);
      if (apiKey) {
        console.log(`使用的API密钥: ${apiKey.substring(0, 5)}...${apiKey.substring(apiKey.length - 5)}`);
      } else {
        console.log('警告: API密钥未设置');
      }

      // 9. 发送绘图请求
      let response;
      let completion;
      try {
        response = await fetch(
          `${this.config.geminiUrl}/v1beta/models/${currentDrawModel}:generateContent?key=${this.config.geminiKey}`,
          {
            method: 'POST',
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              contents: messagesToSend,
              generation_config: {
                response_modalities: [
                  "Text",
                  "Image"
                ]
              },
              safetySettings: [
                {
                  "category": "HARM_CATEGORY_HATE_SPEECH",
                  "threshold": "BLOCK_NONE"
                },
                {
                  "category": "HARM_CATEGORY_SEXUALLY_EXPLICIT",
                  "threshold": "BLOCK_NONE"
                },
                {
                  "category": "HARM_CATEGORY_DANGEROUS_CONTENT",
                  "threshold": "BLOCK_NONE"
                },
                {
                  "category": "HARM_CATEGORY_HARASSMENT",
                  "threshold": "BLOCK_NONE"
                },
                {
                  "category": "HARM_CATEGORY_CIVIC_INTEGRITY",
                  "threshold": "BLOCK_NONE"
                }
              ]
            })
          }
        );

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`HTTP错误 ${response.status}: ${errorText}`);
        }

        completion = await response.json();
        const logCompletion = JSON.parse(JSON.stringify(completion));
        if (logCompletion.candidates && logCompletion.candidates[0] && logCompletion.candidates[0].content && logCompletion.candidates[0].content.parts) {
          for (const part of logCompletion.candidates[0].content.parts) {
            if (part.inlineData && part.inlineData.data) {
              const base64Data = part.inlineData.data;
              const truncatedData = base64Data.substring(0, 100) + '...' + base64Data.substring(base64Data.length - 100);
              part.inlineData.data = `[Base64 Image Data: ${truncatedData}]`;
            }
          }
        }
        console.log('Gemini API 响应:', JSON.stringify(logCompletion, null, 2));

        if (!completion.candidates || !completion.candidates[0] || !completion.candidates[0].content) {
          throw new Error('Gemini API 响应格式不符合预期');
        }

        const candidates = completion.candidates;
        if (!candidates[0] || !candidates[0].content) {
          let errorMessage = '绘图失败，请重试';
          if (candidates[0]?.finishReason) {
            errorMessage += `完成原因: ${candidates[0].finishReason}`;
          }
          if (candidates[0]?.safetyRatings) {
            errorMessage += `安全评级: ${JSON.stringify(candidates[0].safetyRatings)}`;
          }
          logger.error(errorMessage);
          e.reply(errorMessage);
          return true;
        }
        const parts = candidates[0].content.parts;
        if (!parts || parts.length === 0) {
          e.reply('绘图失败，请重试');
          return true;
        }
        let replyMsg = [];
        let aiResponseText = '';

        for (const item of parts) {
          if (item?.text) {
            replyMsg.push(item.text);
            aiResponseText += item.text;
          } else if (item?.inlineData && item.inlineData.data) {
            const base64Data = item.inlineData.data;
            const imageBuffer = Buffer.from(base64Data, 'base64');
            const imageFileName = `draw_${Date.now()}.png`;
            const imagePath = path.join('./data/chatgpt_drawings', imageFileName);
            const dirPath = path.dirname(imagePath);
            if (!fs.existsSync(dirPath)) {
              fs.mkdirSync(dirPath, { recursive: true });
            }
            try {
              fs.writeFileSync(imagePath, imageBuffer);
              replyMsg.push(segment.image(imagePath));
              aiResponseText += '[图片]';
              aiImageData = imagePath;
            } catch (saveError) {
              logger.error('保存图片文件失败:', saveError);
              replyMsg.push('图片保存失败');
              aiResponseText += '[图片保存失败]';
            }
          }
        }
        drawConversationHistory[conversationKey].push({
          role: 'assistant',
          content: aiResponseText,
          parts: parts
        });
        await e.reply(replyMsg, true);
        if (aiImageData && fs.existsSync(aiImageData)) {
          try {
            fs.unlinkSync(aiImageData);
            logger.info(`成功删除本地图片文件: ${aiImageData}`);
          } catch (deleteError) {
            logger.error(`删除本地图片文件失败: ${aiImageData}`, deleteError);
          }
        }
        return true;
      } catch (error) {
        logger.error('Gemini绘图错误:', error);
        let errorMessage = '绘图失败: ';
        if (error.message) {
          errorMessage += error.message;
        } else {
          errorMessage += '未知错误，请稍后重试';
        }
        await e.reply(`发生错误:\n${errorMessage}`);
        if (aiImageData && fs.existsSync(aiImageData)) {
          try {
            fs.unlinkSync(aiImageData);
            logger.info(`错误发生成功删除本地图片文件: ${aiImageData}`);
          } catch (deleteError) {
            logger.error(`错误发生删除本地图片文件失败: ${aiImageData}`, deleteError);
          }
        }
        return false;
      }
    } catch (error) {
      logger.error('Draw方法错误:', error);
      let errorMessage = '绘图失败: ';
      if (error.message) {
        errorMessage += error.message;
      } else {
        errorMessage += '未知错误，请稍后重试';
      }
      await e.reply(`发生错误:\n${errorMessage}`);
      if (aiImageData && fs.existsSync(aiImageData)) {
        try {
          fs.unlinkSync(aiImageData);
          logger.info(`错误发生成功删除本地图片文件: ${aiImageData}`);
        } catch (deleteError) {
          logger.error(`错误发生删除本地图片文件失败: ${aiImageData}`, deleteError);
        }
      }
      return false;
    }
  }

  async getGroupPreset(groupId) {
    const presetName = this.config.groupPresets[groupId];
    return presetName ? this.config.presets[presetName] : null;
  }

  async clearContent(e) {
    const groupId = e.group_id || 'private';
    const conversationKey = groupId;

    const chatMessageCount = (chatConversationHistory[conversationKey] || []).length;
    const drawMessageCount = (drawConversationHistory[conversationKey] || []).length;

    if (chatConversationHistory[conversationKey]) {
      delete chatConversationHistory[conversationKey];
    }
    if (drawConversationHistory[conversationKey]) {
      delete drawConversationHistory[conversationKey];
    }

    // 重新添加预设内容
    const preset = await this.getGroupPreset(groupId);
    if (preset) {
      if (!chatConversationHistory[conversationKey]) {
        chatConversationHistory[conversationKey] = [];
      }
      chatConversationHistory[conversationKey].push({ role: 'system', content: preset });
    }

    let replyMessage = '已清空对话记录：';
    let hasContent = false;

    if (chatMessageCount > 0) {
      replyMessage += `chat(${chatMessageCount}条)`;
      hasContent = true;
    }

    if (drawMessageCount > 0) {
      if (hasContent) {
        replyMessage += ', ';
      }
      replyMessage += `draw(${drawMessageCount}条)`;
      hasContent = true;
    }

    if (!hasContent) {
      replyMessage = '没有可清空的对话记录';
    }

    await e.reply(replyMessage, true);
  }

  async setApiUrl(e) {
    if (!this.e.isMaster) {
      e.reply('只有主人才能设置API URL');
      return;
    }
    if (e.message_type !== 'private') {
      e.reply('请在私聊中设置API URL');
      return;
    }
    const match = e.msg.match(/^设置apiurl([1-8])(.*)$/);
    if (!match) {
      e.reply('请使用正确的格式: 设置apiurl1、设置apiurl2、设置apiurl3 或 设置apiurl4等');
      return;
    }
    const urlNum = match[1];
    const apiUrl = match[2].trim();
    if (!apiUrl) {
      e.reply('请提供有效的API URL');
      return;
    }
    // 设置对应编号的URL
    const urlName = `apiBaseUrl${urlNum}`;
    this.config[urlName] = apiUrl;
    this.saveConfig();
    e.reply(`API URL${urlNum}设置成功`);
  }

  async deleteApiUrl(e) {
    if (!this.e.isMaster) {
      e.reply('只有主人才能删除API URL');
      return;
    }
    if (e.message_type !== 'private') {
      e.reply('请在私聊中删除API URL');
      return;
    }
    const match = e.msg.match(/^删除apiurl([1-8])$/);
    if (!match) {
      e.reply('请使用正确的格式: 删除apiurl1、删除apiurl2、删除apiurl3 或 删除apiurl4等');
      return;
    }
    const urlNum = match[1];
    const urlName = `apiBaseUrl${urlNum}`;
    if (this.config[urlName]) {
      this.config[urlName] = '';
      this.saveConfig();
      e.reply(`API URL${urlNum}已删除`);
    } else {
      e.reply(`API URL${urlNum}不存在或已经为空`);
    }
  }

  async setGeminiKey(e) {
    if (!this.e.isMaster) {
      e.reply('只有主人才能设置Gemini Key')
      return
    }
    if (e.message_type !== 'private') {
      e.reply('请在私聊中设置Gemini Key')
      return
    }
    const key = e.msg.replace(/^设置geminikey/, '').trim()
    if (!key) {
      e.reply('请提供有效的Gemini Key')
      return
    }
    this.config.geminiKey = key
    this.saveConfig()
    e.reply('Gemini Key设置成功')
  }

  async deleteGeminiKey(e) {
    if (!this.e.isMaster) {
      e.reply('只有主人才能删除Gemini Key')
      return
    }
    if (e.message_type !== 'private') {
      e.reply('请在私聊中删除Gemini Key')
      return
    }
    if (this.config.geminiKey) {
      this.config.geminiKey = ''
      this.saveConfig()
      e.reply('Gemini Key已删除')
    } else {
      e.reply('Gemini Key不存在或已经为空')
    }
  }

  async setApiKey(e) {
    if (!this.e.isMaster) {
      e.reply('只有主人才能设置APIKey')
      return
    }
    if (e.message_type !== 'private') {
      e.reply('请在私聊中设置APIKey')
      return
    }
    const match = e.msg.match(/^设置apikey([1-8])(.*)$/)
    if (!match) {
      e.reply('请使用正确的格式:设置apikey1、设置apikey2、设置apikey3 或 设置apikey4等')
      return
    }

    const keyNum = match[1]
    const apiKey = match[2].trim()

    if (!apiKey) {
      e.reply('请提供有效的APIKey')
      return
    }

    // 设置对应编号的key
    const keyName = `apiKey${keyNum}`
    this.config[keyName] = apiKey
    this.saveConfig()
    e.reply(`APIKey${keyNum}设置成功`)
  }

  async deleteApiKey(e) {
    if (!this.e.isMaster) {
      e.reply('只有主人才能删除APIKey')
      return
    }
    if (e.message_type !== 'private') {
      e.reply('请在私聊中删除APIKey')
      return
    }
    const match = e.msg.match(/^删除apikey([1-8])$/)
    if (!match) {
      e.reply('请使用正确的格式:删除apikey1、删除apikey2、删除apikey3 或 删除apikey4等')
      return
    }

    const keyNum = match[1]
    const keyName = `apiKey${keyNum}`

    if (this.config[keyName]) {
      this.config[keyName] = ''
      this.saveConfig()
      e.reply(`APIKey${keyNum}已删除`)
    } else {
      e.reply(`APIKey${keyNum}不存在或已经为空`)
    }
  }

  async authorizeGroup(e) {
    if (!this.e.isMaster) {
      e.reply('只有主人才能授权群组')
      return
    }

    if (!e.group_id) {
      e.reply('请在群聊中使用此命令')
      return
    }

    if (this.config.authorizedGroups.includes(e.group_id)) {
      e.reply('该群已被授权使用key')
      return
    }

    this.config.authorizedGroups.push(e.group_id)
    this.saveConfig()
    e.reply('群聊授权成功,现在可以使用key了')
  }

  async unauthorizeGroup(e) {
    if (!this.e.isMaster) {
      e.reply('只有主人才能取消授权群组')
      return
    }

    if (!e.group_id) {
      e.reply('请在群聊中使用此命令')
      return
    }

    const index = this.config.authorizedGroups.indexOf(e.group_id)
    if (index === -1) {
      e.reply('该群未被授权使用key')
      return
    }

    this.config.authorizedGroups.splice(index, 1)
    this.saveConfig()
    e.reply('已取消该群的授权')
  }

  async viewUrlsAndKeys(e) {
    if (!this.e.isMaster) {
      e.reply('只有主人才能查看URL和Key');
      return;
    }

    if (e.message_type !== 'private') {
      e.reply('请在私聊中查看URL和Key');
    }

    let infoLines = [];
    let hasInfo = false;

    const truncateString = (str, maxLength = 30) => {
      if (str.length <= maxLength) return str;
      return `${str.substring(0, maxLength / 2)}...${str.substring(str.length - maxLength / 2)}`;
    };

    if (this.config.geminiUrl) {
      infoLines.push(`geminiurl: ${truncateString(this.config.geminiUrl)}`);
      hasInfo = true;
    }
    if (this.config.geminiKey) {
      infoLines.push(`geminikey: ${truncateString(this.config.geminiKey)}`);
      hasInfo = true;
    }

    for (let i = 1; i <= 8; i++) {
      const apiUrlName = `apiBaseUrl${i}`;
      const apiKeyName = `apiKey${i}`;
      if (this.config[apiUrlName]) {
        infoLines.push(`${apiUrlName}: ${truncateString(this.config[apiUrlName])}`);
        hasInfo = true;
      }
      if (this.config[apiKeyName]) {
        infoLines.push(`${apiKeyName}: ${truncateString(this.config[apiKeyName])}`);
        hasInfo = true;
      }
    }

    if (!hasInfo) {
      const msg = '您还没有设置任何API URL或Key。';
      if (e.friend) {
        await e.friend.sendMsg(msg);
      } else {
        await e.bot.sendPrivateMsg(e.user_id, msg);
      }
      return;
    }

    const infoText = '您的API URL和Key信息:\n' + infoLines.join('\n');
    if (e.friend) {
      await e.friend.sendMsg(infoText);
    } else {
      await e.bot.sendPrivateMsg(e.user_id, infoText);
    }
  }

  async addModel(e) {
    if (!this.e.isMaster) {
      e.reply('只有主人才能添加模型');
      return;
    }

    const input = e.msg.replace(/^添加模型/, '').trim();
    const parts = input.split(/\s+/);

    if (parts.length < 2) {
      e.reply('请使用正确的格式: 添加模型 [模型名称] [关联的Key或URL名称]\n例如: 添加模型 gemini-exp-1206 geminiurl\n关联名称支持: geminikey, geminiurl, apikey1-8, apiurl1-8');
      return;
    }

    const modelName = parts[0];
    const apiAssociationInput = parts[1];

    let apiAssociation;
    if (apiAssociationInput === 'geminikey' || apiAssociationInput === 'geminiurl') {
      apiAssociation = 'geminiUrl';
    } else if (apiAssociationInput.startsWith('apikey') || apiAssociationInput.startsWith('apiurl')) {
      const keyNum = apiAssociationInput.replace(/apikey|apiurl/, '');
      if (!/^[1-8]$/.test(keyNum)) {
        e.reply('关联的Key或URL编号无效，请使用1-8之间的数字');
        return;
      }
      apiAssociation = `apiBaseUrl${keyNum}`;
    } else {
      e.reply('无效的关联名称，请使用 geminikey, geminiurl, apikey1-8 或 apiurl1-8');
      return;
    }

    if (this.config.models.includes(modelName)) {
      e.reply(`模型 '${modelName}' 已经存在`);
      return;
    }

    if (apiAssociation === 'geminiUrl') {
      if (!this.config.geminiUrl && !this.config.geminiKey) {
        e.reply('关联的 geminiUrl 或 geminiKey 未设置，请先设置');
        return;
      }
    } else if (apiAssociation.startsWith('apiBaseUrl')) {
      const keyNum = apiAssociation.replace('apiBaseUrl', '');
      const apiKeyName = `apiKey${keyNum}`;
      const apiUrlName = `apiBaseUrl${keyNum}`;
      if (!this.config[apiUrlName] && !this.config[apiKeyName]) {
        e.reply(`关联的 ${apiUrlName} 或 ${apiKeyName} 不存在或未设置，请先设置`);
        return;
      }
    }

    this.config.models.push(modelName);
    this.config.models.sort();
    this.config.modelApiMap[modelName] = apiAssociation;

    const sortedModelApiMap = {};
    this.config.models.forEach(model => {
      if (model in this.config.modelApiMap) {
        sortedModelApiMap[model] = this.config.modelApiMap[model];
      }
    });
    this.config.modelApiMap = sortedModelApiMap;

    this.saveConfig();
    logger.info(`模型 '${modelName}' 添加成功，并关联到 ${apiAssociation}. 当前模型列表: ${JSON.stringify(this.config.models)}`);
    e.reply(`模型 '${modelName}' 添加成功，并关联到 ${apiAssociation}`);
  }

  async deleteModel(e) {
    if (!this.e.isMaster) {
      e.reply('只有主人才能删除模型');
      return;
    }

    const input = e.msg.replace(/^删除模型/, '').trim();
    logger.info(`尝试删除模型: '${input}'. 当前模型列表: ${JSON.stringify(this.config.models)}`);

    if (!input) {
      e.reply('请提供要删除的模型名称或序号');
      return;
    }

    let modelNameToDelete = null;
    let modelIndexToDelete = -1;

    if (/^\d+$/.test(input)) {
      const index = parseInt(input) - 1;
      if (index >= 0 && index < this.config.models.length) {
        modelNameToDelete = this.config.models[index];
        modelIndexToDelete = index;
      } else {
        e.reply('无效的模型序号');
        return;
      }
    } else {
      modelNameToDelete = input;
      modelIndexToDelete = this.config.models.indexOf(modelNameToDelete);
      if (modelIndexToDelete === -1) {
        e.reply(`模型 '${modelNameToDelete}' 不存在`);
        return;
      }
    }

    for (const groupId in this.config.groupCurrentModels) {
      if (this.config.groupCurrentModels[groupId] === modelNameToDelete) {
        this.config.groupCurrentModels[groupId] = '';
      }
    }

    for (const groupId in this.config.groupDefaultModels) {
      if (this.config.groupDefaultModels[groupId] === modelNameToDelete) {
        this.config.groupDefaultModels[groupId] = '';
      }
    }
    if (this.config.groupCurrentModels['private'] === modelNameToDelete) {
      this.config.groupCurrentModels['private'] = '';
    }
    if (this.config.groupDefaultModels['private'] === modelNameToDelete) {
      this.config.groupDefaultModels['private'] = '';
    }
    this.config.models.splice(modelIndexToDelete, 1);
    delete this.config.modelApiMap[modelNameToDelete];

    this.saveConfig();

    e.reply(`模型 '${modelNameToDelete}' 删除成功`);
  }

  async listModels(e) {
    const modelList = this.config.models.map((model, index) => `${index + 1}. ${model}`).join('\n');
    const messageContent = `可用模型列表:\n${modelList || '暂无可用模型'}`;
    const forwardMsg = [{
      message: messageContent,
      nickname: e.sender.card || e.user_id,
      user_id: e.user_id,
    }];

    await e.reply(Bot.makeForwardMsg(forwardMsg));
  }

  async currentModel(e) {
    const groupId = e.group_id || 'private';
    const currentModel = this.config.groupCurrentModels[groupId];
    const defaultModel = this.config.groupDefaultModels[groupId];

    if (!currentModel && !defaultModel) {
      e.reply('未设置当前模型，请使用"切换模型"或"设置默认模型"命令配置模型');
      return;
    }

    const displayModel = currentModel || defaultModel;
    e.reply(`当前使用的模型是: ${displayModel}`);
  }

  async defaultModel(e) {
    const groupId = e.group_id || 'private';
    const defaultModel = this.config.groupDefaultModels[groupId];

    if (!defaultModel) {
      e.reply('未设置默认模型，请使用"设置默认模型"命令配置模型');
      return;
    }

    e.reply(`默认的模型是: ${defaultModel}`);
  }

  async switchModel(e) {
    if (!this.e.isMaster) {
      e.reply('只有主人才能切换模型');
      return;
    }

    const input = e.msg.replace(/^切换模型/, '').trim();
    let model;

    if (/^\d+$/.test(input)) {
      const index = parseInt(input) - 1;
      model = this.config.models[index];
    } else {
      model = input;
    }

    if (!this.config.models.includes(model)) {
      e.reply('无效的模型名称或序号,请使用 "模型列表" 命令查看可用模型');
      return;
    }

    const groupId = e.group_id || 'private';
    this.config.groupCurrentModels[groupId] = model;
    this.saveConfig();
    e.reply(`已为当前${groupId === 'private' ? '私聊' : '群聊'}切换到模型: ${model}`);
  }

  async setDefaultModel(e) {
    if (!this.e.isMaster) {
      e.reply('只有主人才能设置默认模型');
      return;
    }

    const input = e.msg.replace(/^设置默认模型/, '').trim();
    let model;

    if (/^\d+$/.test(input)) {
      const index = parseInt(input) - 1;
      model = this.config.models[index];
    } else {
      model = input;
    }

    if (!this.config.models.includes(model)) {
      e.reply('无效的模型名称或序号,请使用 "模型列表" 命令查看可用模型');
      return;
    }

    const groupId = e.group_id || 'private';
    this.config.groupDefaultModels[groupId] = model;
    this.saveConfig();
    e.reply(`已为当前${groupId === 'private' ? '私聊' : '群聊'}设置默认模型为: ${model}`);
  }

  async addDrawModel(e) {
    if (!this.e.isMaster) {
      e.reply('只有主人才能添加绘图模型');
      return;
    }

    const modelName = e.msg.replace(/^添加绘图模型/, '').trim();
    if (!modelName) {
      e.reply('请提供要添加的绘图模型名称');
      return;
    }

    // 检查是否已经存在
    if (this.config.drawModels.includes(modelName)) {
      e.reply(`绘图模型 '${modelName}' 已经存在`);
      return;
    }

    this.config.drawModels.push(modelName);
    // 添加后排序绘图模型列表
    this.config.drawModels.sort();
    this.saveConfig();
    e.reply(`绘图模型 '${modelName}' 添加成功`);
  }

  async deleteDrawModel(e) {
    if (!this.e.isMaster) {
      e.reply('只有主人才能删除绘图模型');
      return;
    }

    const input = e.msg.replace(/^删除绘图模型/, '').trim();
    if (!input) {
      e.reply('请提供要删除的绘图模型名称或序号');
      return;
    }

    let drawModelNameToDelete = null;
    let drawModelIndexToDelete = -1;

    if (/^\d+$/.test(input)) {
      const index = parseInt(input) - 1;
      if (index >= 0 && index < this.config.drawModels.length) {
        drawModelNameToDelete = this.config.drawModels[index];
        drawModelIndexToDelete = index;
      } else {
        e.reply('无效的绘图模型序号');
        return;
      }
    } else {
      drawModelNameToDelete = input;
      drawModelIndexToDelete = this.config.drawModels.indexOf(drawModelNameToDelete);
      if (drawModelIndexToDelete === -1) {
        e.reply(`绘图模型 '${drawModelNameToDelete}' 不存在`);
        return;
      }
    }
    for (const groupId in this.config.groupCurrentDrawModels) {
      if (this.config.groupCurrentDrawModels[groupId] === drawModelNameToDelete) {
        this.config.groupCurrentDrawModels[groupId] = '';
      }
    }

    for (const groupId in this.config.groupDefaultDrawModels) {
      if (this.config.groupDefaultDrawModels[groupId] === drawModelNameToDelete) {
        this.config.groupDefaultDrawModels[groupId] = '';
      }
    }
    if (this.config.groupCurrentDrawModels['private'] === drawModelNameToDelete) {
      this.config.groupCurrentDrawModels['private'] = '';
    }
    if (this.config.groupDefaultDrawModels['private'] === drawModelNameToDelete) {
      this.config.groupDefaultDrawModels['private'] = '';
    }
    this.config.drawModels.splice(drawModelIndexToDelete, 1);

    this.saveConfig();
    e.reply(`绘图模型 '${drawModelNameToDelete}' 删除成功`);
  }

  async listDrawModels(e) {
    const drawModelList = this.config.drawModels.map((model, index) => `${index + 1}. ${model}`).join('\n');
    const messageContent = `可用绘图模型列表:\n${drawModelList || '暂无可用绘图模型'}`;

    const forwardMsg = [{
      message: messageContent,
      nickname: e.sender.card || e.user_id,
      user_id: e.user_id,
    }];

    await e.reply(Bot.makeForwardMsg(forwardMsg));
  }

  async currentDrawModel(e) {
    const groupId = e.group_id || 'private';
    const currentDrawModel = this.config.groupCurrentDrawModels[groupId];
    const defaultDrawModel = this.config.groupDefaultDrawModels[groupId];
    let displayModel;
    let message;
    if (currentDrawModel) {
      displayModel = currentDrawModel;
      message = `当前使用的绘图模型是: ${displayModel}`;
    } else if (defaultDrawModel) {
      displayModel = defaultDrawModel;
      message = `默认的绘图模型是: ${displayModel}`;
    } else {
      displayModel = "gemini-2.0-flash-exp";
      message = `当前使用的绘图模型是: ${displayModel}`;
    }
    e.reply(message);
  }

  async switchDrawModel(e) {
    if (!this.e.isMaster) {
      e.reply('只有主人才能切换绘图模型');
      return;
    }

    const input = e.msg.replace(/^切换绘图模型/, '').trim();
    let model;

    if (/^\d+$/.test(input)) {
      const index = parseInt(input) - 1;
      model = this.config.drawModels[index];
    } else {
      model = input;
    }

    if (!this.config.drawModels.includes(model)) {
      e.reply('无效的绘图模型名称或序号,请使用 "绘图模型列表" 命令查看可用模型');
      return;
    }

    const groupId = e.group_id || 'private';
    this.config.groupCurrentDrawModels[groupId] = model;
    this.saveConfig();
    e.reply(`已为当前${groupId === 'private' ? '私聊' : '群聊'}切换到绘图模型: ${model}`);
  }

  async defaultDrawModel(e) {
    const groupId = e.group_id || 'private';
    const defaultDrawModel = this.config.groupDefaultDrawModels[groupId];

    if (!defaultDrawModel) {
      e.reply('未设置默认绘图模型，请使用"设置默认绘图模型"命令配置模型');
      return;
    }

    e.reply(`默认的绘图模型是: ${defaultDrawModel}`);
  }

  async setDefaultDrawModel(e) {
    if (!this.e.isMaster) {
      e.reply('只有主人才能设置默认绘图模型');
      return;
    }

    const input = e.msg.replace(/^设置默认绘图模型/, '').trim();
    let model;

    if (/^\d+$/.test(input)) {
      const index = parseInt(input) - 1;
      model = this.config.drawModels[index];
    } else {
      model = input;
    }

    if (!this.config.drawModels.includes(model)) {
      e.reply('无效的绘图模型名称或序号,请使用 "绘图模型列表" 命令查看可用模型');
      return;
    }

    const groupId = e.group_id || 'private';
    this.config.groupDefaultDrawModels[groupId] = model;
    this.saveConfig();
    e.reply(`已为当前${groupId === 'private' ? '私聊' : '群聊'}设置默认绘图模型为: ${model}`);
  }

  async addPreset(e) {
    const [name, ...contentArr] = e.msg.replace(/^添加预设/, '').trim().split(/\s+/);
    const content = contentArr.join(' ').trim();
    if (!name) {
      e.reply('请提供预设名称');
      return;
    }

    this.config.presets[name] = content || '';
    this.saveConfig();
    e.reply(`预设 '${name}' 添加成功`);
  }

  async setPreset(e) {
    const name = e.msg.replace(/^切换预设/, '').trim();
    if (!name) {
      e.reply('请提供要切换的预设名称');
      return;
    }

    console.log(`尝试切换预设:${name}, 内容:${this.config.presets[name]}`);

    if (!(name in this.config.presets)) {
      e.reply(`预设 ${name} 不存在`);
      return;
    }

    const groupId = e.group_id || 'private';
    this.config.groupPresets[groupId] = name;
    this.saveConfig();

    if (chatConversationHistory[groupId]) {
      delete chatConversationHistory[groupId];
    }
    if (drawConversationHistory[groupId]) {
      delete drawConversationHistory[groupId];
    }
    e.reply(`已为当前${e.group_id ? '群聊' : '私聊'}切换预设:${name}\n本群记忆已清除`);
  }

  async currentPreset(e) {
    const groupId = e.group_id || 'private';
    const presetName = this.config.groupPresets[groupId];
    if (presetName) {
      e.reply(`当前预设为:${presetName}`);
    } else {
      e.reply('当前没有设置预设');
    }
  }

  async viewPreset(e) {
    const name = e.msg.replace(/^查看预设/, '').trim();
    if (!name) {
      e.reply('请提供要查看的预设名称');
      return;
    }
    if (!(name in this.config.presets)) {
      e.reply(`预设 '${name}' 不存在`);
      return;
    }
    const content = this.config.presets[name];
    const messageContent = `预设信息:${name}\n${content || '(空预设)'}`;

    const forwardMsg = [{
      message: messageContent,
      nickname: e.sender.card || e.user_id,
      user_id: e.user_id,
    }];

    await e.reply(Bot.makeForwardMsg(forwardMsg));
  }

  async deletePreset(e) {
    const name = e.msg.replace(/^删除预设/, '').trim();
    if (!name) {
      e.reply('请提供要删除的预设名称');
      return;
    }

    if (!(name in this.config.presets)) {
      e.reply(`预设 '${name}' 不存在`);
      return;
    }

    delete this.config.presets[name];
    this.saveConfig();
    e.reply(`预设 '${name}' 删除成功`);
  }

  async listPresets(e) {
    const presetList = Object.keys(this.config.presets).join('\n');
    const messageContent = `预设列表:\n${presetList || '暂无预设'}`;

    const forwardMsg = [{
      message: messageContent,
      nickname: e.sender.card || e.user_id,
      user_id: e.user_id,
    }];

    await e.reply(Bot.makeForwardMsg(forwardMsg));
  }

  async setContextMemory(e) {
    const input = e.msg.replace(/^设置上下文记忆/, '').trim();
    const memory = parseInt(input);

    if (isNaN(memory) || memory < 1) {
      e.reply('请输入有效的数字(大于等于1)');
      return;
    }

    const groupId = e.group_id || 'private';
    this.config.groupContextMemory[groupId] = memory;
    this.saveConfig();
    e.reply(`已为当前${groupId === 'private' ? '私聊' : '群聊'}设置上下文记忆为: ${memory}条`);
  }

  async showHelp(e) {
    const helpText = `ChatGPT 插件帮助:
       1. //xxx - 与 ChatGPT 对话
       2. //绘图xxx - 使用gemini-2.0-flash-exp绘图
       3. 设置apiurl1-8 [url] - 设置API URL(仅主人,私聊)
       4. 删除apiurl1-8 - 删除API URL(仅主人,私聊)
       5. 设置geminikey [key] - 设置Gemini API Key(仅主人,私聊)
       6. 设置apikey1-8 [key] - 设置API Key(仅主人,私聊)
       7. 删除geminikey - 删除Gemini API Key(仅主人,私聊)
       8. 删除apikey1-8 - 删除API Key(仅主人,私聊)
       9. 查看url - 查看所有已设置的URL和Key(仅主人,私聊)
      10. 添加模型 [模型名称] [关联的Key或URL名称] - 添加新模型并关联Key/URL(仅主人)
      11. 删除模型 [模型名/序号] - 删除指定模型(仅主人)
      12. 授权使用key - 授权当前群组使用 API(仅主人)
      13. 取消授权使用key - 取消当前群组的API使用授权(仅主人)
      14. 模型列表 - 显示可用的模型列表
      15. 当前模型 - 显示当前使用的模型
      16. 切换模型 [模型名/序号] - 切换模型(仅主人)
      17. 默认模型 - 显示默认的AI模型
      18. 设置默认模型 [模型名/序号] - 设置默认的模型(仅主人)
      19. 添加绘图模型 [模型名称] - 添加新绘图模型(仅主人)
      20. 删除绘图模型 [模型名/序号] - 删除指定绘图模型(仅主人)
      21. 绘图模型列表 - 显示可用的绘图模型列表
      22. 当前绘图模型 - 显示当前使用的绘图模型
      23. 切换绘图模型 [模型名/序号] - 切换绘图模型(仅主人)
      24. 默认绘图模型 - 显示默认的绘图模型
      25. 设置默认绘图模型 [模型名/序号] - 设置默认的绘图模型(仅主人)
      26. 添加预设 [名称] [内容] - 添加对话预设(内容可选)
      27. 切换预设 [名称] - 为当前群聊/私聊设置默认预设
      28. 当前预设 - 查看当前会话的预设
      29. 查看预设 [名称] - 查看指定预设的信息
      30. 删除预设 [名称] - 删除对话预设
      31. 预设列表 - 显示所有可用的预设
      32. 设置上下文记忆 [数字] - 设置上下文记忆的对话条数(默认为10)
      33. 清空对话 - 清空掉当前的上下文对话
      34. chatgpt帮助 - 显示此帮助信息
      注: 请先使用切换模型或者设置默认模型设置当前群聊的模型`

    const forwardMsg = [{
      message: helpText,
      nickname: e.sender.card || e.user_id,
      user_id: e.user_id,
    }];

    await e.reply(Bot.makeForwardMsg(forwardMsg));
  }
}

