import fetch from 'node-fetch';
import dotenv from 'dotenv';
import { logger } from './logger';

dotenv.config();

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;

// 验证必需的环境变量
function validateConfig(): { botToken: string; chatId: string } {
  if (!BOT_TOKEN || !CHAT_ID) {
    throw new Error('请在环境变量中配置 BOT_TOKEN 和 CHAT_ID');
  }
  return { botToken: BOT_TOKEN, chatId: CHAT_ID };
}

/**
 * 发送 Telegram 消息，包含重试机制和详细错误处理
 * @param text 要发送的消息文本
 * @param retries 重试次数，默认为 3
 */
export async function sendTelegramMessage(text: string, retries: number = 3): Promise<void> {
  const { botToken, chatId } = validateConfig();

  // 验证消息长度（Telegram 限制为 4096 字符）
  if (text.length > 4096) {
    logger.warn('消息长度超过 Telegram 限制，将被截断', {
      originalLength: text.length,
      maxLength: 4096
    });
    text = text.substring(0, 4093) + '...';
  }

  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      logger.debug(`尝试发送 Telegram 消息 (第 ${attempt} 次)`, {
        messageLength: text.length,
        chatId: chatId.substring(0, 4) + '***' // 部分隐藏敏感信息
      });

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'LabubuWatcher/1.0'
        },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true
        }),
        timeout: 10000 // 10秒超时
      });

      if (res.ok) {
        logger.success('Telegram 消息发送成功');
        return;
      }

      const errorText = await res.text();
      const errorData = {
        status: res.status,
        statusText: res.statusText,
        response: errorText,
        attempt,
        maxRetries: retries
      };

      if (attempt === retries) {
        logger.error('Telegram 消息发送失败，已达到最大重试次数', errorData);
        throw new Error(`Telegram 推送失败: ${res.status} ${res.statusText} - ${errorText}`);
      } else {
        logger.warn(`Telegram 消息发送失败，将重试`, errorData);
        // 指数退避：等待时间随重试次数增加
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
      }

    } catch (error) {
      const errorData = {
        attempt,
        maxRetries: retries,
        error: error instanceof Error ? error.message : String(error)
      };

      if (attempt === retries) {
        logger.error('Telegram 消息发送失败，网络或其他错误', errorData);
        throw error;
      } else {
        logger.warn('Telegram 消息发送遇到错误，将重试', errorData);
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
      }
    }
  }
}