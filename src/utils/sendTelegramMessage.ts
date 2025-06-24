import fetch from 'node-fetch'
import dotenv from 'dotenv'
dotenv.config()

const BOT_TOKEN = process.env.BOT_TOKEN
const CHAT_ID = process.env.CHAT_ID

if (!BOT_TOKEN || !CHAT_ID) {
  throw new Error('请在 .env 文件中配置 BOT_TOKEN 和 CHAT_ID')
}

export async function sendTelegramMessage(text: string) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    })
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error('Telegram 推送失败: ' + err)
  }
} 