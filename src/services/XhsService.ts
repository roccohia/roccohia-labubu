import { XhsScraper } from '../scrapers/XhsScraper';
import { XhsPostData } from '../types';
import { LoggerInstance } from '../utils/logger';
import { StatusManager } from '../utils/statusManager';
import { sendTelegramMessage } from '../utils/sendTelegramMessage';

/**
 * 小红书监控服务
 * 专门处理小红书相关的业务逻辑
 */
export class XhsService {
  private logger: LoggerInstance;
  private statusManager: StatusManager<string[]>;
  private config: {
    searchKeyword: string;
    matchKeywords: string[];
    seenPostsFile: string;
    maxSeenPosts: number;
  };

  constructor(
    logger: LoggerInstance,
    statusManager: StatusManager<string[]>,
    config: any
  ) {
    this.logger = logger;
    this.statusManager = statusManager;
    this.config = config;
  }

  /**
   * 处理小红书帖子数据
   */
  async processPosts(posts: XhsPostData[]): Promise<void> {
    this.logger.info(`开始处理 ${posts.length} 个帖子，进行关键词匹配和去重`);

    const seenPosts = this.statusManager.get();
    let newPostsSent = 0;
    let duplicatePosts = 0;
    let keywordMatches = 0;

    for (const post of posts) {
      this.logger.debug(`处理帖子: ${post.previewTitle} (${post.publishTime || '时间未知'})`);

      // 时间过滤：只处理5小时内的帖子
      if (!this.isPostWithin5Hours(post.publishTime)) {
        this.logger.debug(`帖子超过5小时，跳过: ${post.previewTitle} (${post.publishTime})`);
        continue;
      }

      // 关键词匹配
      if (!this.matchesKeywords(post.previewTitle)) {
        this.logger.debug(`帖子不包含关键词，跳过: ${post.previewTitle}`);
        continue;
      }

      keywordMatches++;

      // 去重检查
      if (seenPosts.includes(post.url)) {
        this.logger.debug(`帖子已推送过，跳过: ${post.previewTitle}`);
        duplicatePosts++;
        continue;
      }

      // 发送新帖子
      this.logger.success(`发现新的关键词匹配帖子: ${post.previewTitle} (${post.publishTime})`);

      try {
        await this.sendNotification(post);
        
        // 添加到已推送列表
        seenPosts.push(post.url);
        newPostsSent++;
        
        this.logger.success(`✅ 帖子推送成功: ${post.previewTitle}`);
      } catch (error) {
        this.logger.error('通知发送失败:', error);
        this.logger.error(`❌ 帖子推送失败，不记录到去重列表: ${post.previewTitle}`, error);
        continue;
      }
    }

    // 更新状态
    if (newPostsSent > 0) {
      // 限制已推送列表大小
      if (seenPosts.length > this.config.maxSeenPosts) {
        const removeCount = seenPosts.length - this.config.maxSeenPosts;
        seenPosts.splice(0, removeCount);
        this.logger.info(`清理旧记录 ${removeCount} 条，保持列表大小在 ${this.config.maxSeenPosts} 以内`);
      }

      this.statusManager.set(seenPosts);
      this.statusManager.save();
      this.logger.info(`📝 状态文件已更新，新增 ${newPostsSent} 条记录`);
    } else {
      this.logger.info('📝 无新的成功推送，状态文件保持不变');
    }

    this.logger.info(`处理完成 - 总帖子: ${posts.length}, 关键词匹配: ${keywordMatches}, 新发送: ${newPostsSent}, 重复: ${duplicatePosts}`);

    if (newPostsSent === 0) {
      this.logger.info('暂无符合条件的新帖子');
    }
  }

  /**
   * 检查帖子是否在5小时内
   */
  private isPostWithin5Hours(publishTime?: string): boolean {
    if (!publishTime) return true; // 如果没有时间信息，默认通过

    const now = new Date();
    const fiveHoursAgo = new Date(now.getTime() - 5 * 60 * 60 * 1000); // 5小时前

    // 处理各种时间格式
    if (publishTime.includes('分钟前') || publishTime.includes('刚刚')) {
      return true; // 分钟前肯定在5小时内
    }

    if (publishTime.includes('小时前')) {
      const hoursMatch = publishTime.match(/(\d+)小时前/);
      if (hoursMatch) {
        const hours = parseInt(hoursMatch[1]);
        return hours <= 5; // 只接受5小时内的帖子
      }
      return true; // 如果无法解析具体小时数，默认通过
    }

    // 天前的帖子都超过5小时，直接拒绝
    if (publishTime.includes('天前')) {
      return false;
    }

    // 昨天、前天的帖子都超过5小时，直接拒绝
    if (publishTime.includes('昨天') || publishTime.includes('前天')) {
      return false;
    }

    // 今天的帖子需要进一步判断
    if (publishTime.includes('今天')) {
      return true; // 今天的帖子可能在5小时内，默认通过
    }

    // 处理 MM-DD 格式（这些都是较早的帖子，超过5小时）
    const dateMatch = publishTime.match(/(\d{1,2})-(\d{1,2})/);
    if (dateMatch) {
      return false; // MM-DD格式的帖子都是较早的，超过5小时
    }

    // 处理 "编辑于 X小时前" 格式
    const editHoursMatch = publishTime.match(/编辑于\s*(\d+)小时前/);
    if (editHoursMatch) {
      const hours = parseInt(editHoursMatch[1]);
      return hours <= 5;
    }

    // 处理 "编辑于 X天前" 格式
    const editDaysMatch = publishTime.match(/编辑于\s*(\d+)天前/);
    if (editDaysMatch) {
      return false; // 天前的都超过5小时
    }

    // 处理 "发布于 X小时前" 格式
    const publishHoursMatch = publishTime.match(/发布于\s*(\d+)小时前/);
    if (publishHoursMatch) {
      const hours = parseInt(publishHoursMatch[1]);
      return hours <= 5;
    }

    // 处理 "发布于 X天前" 格式
    const publishDaysMatch = publishTime.match(/发布于\s*(\d+)天前/);
    if (publishDaysMatch) {
      return false; // 天前的都超过5小时
    }

    // 默认通过（如果无法解析时间格式）
    return true;
  }

  /**
   * 检查标题是否匹配关键词
   */
  private matchesKeywords(title: string): boolean {
    const titleLower = title.toLowerCase();
    return this.config.matchKeywords.some(keyword => 
      titleLower.includes(keyword.toLowerCase())
    );
  }

  /**
   * 发送通知
   */
  private async sendNotification(post: XhsPostData): Promise<void> {
    const message = this.formatMessage(post);
    await sendTelegramMessage(message);
  }

  /**
   * 格式化消息
   */
  private formatMessage(post: XhsPostData): string {
    const title = post.previewTitle || '无标题';
    const time = post.publishTime || '时间未知';
    const author = post.author || '作者未知';
    const location = post.location || '';
    
    let message = `🔥 小红书新帖子\n\n`;
    message += `📝 标题: ${title}\n`;
    message += `👤 作者: ${author}\n`;
    message += `⏰ 时间: ${time}`;
    
    if (location) {
      message += ` ${location}`;
    }
    
    message += `\n🔗 链接: ${post.url}`;
    
    return message;
  }
}
