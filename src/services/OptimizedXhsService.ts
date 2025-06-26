import { XhsScraper } from '../scrapers/XhsScraper';
import { XhsPostData } from '../types';
import { LoggerInstance } from '../utils/logger';
import { StatusManager } from '../utils/statusManager';
import { sendTelegramMessage } from '../utils/sendTelegramMessage';
import { globalCache, httpCache } from '../utils/OptimizedCacheManager';

/**
 * 缓存键生成器
 */
class CacheKeyGenerator {
  static postContent(url: string): string {
    return `xhs_post_content_${url}`;
  }

  static postMetadata(url: string): string {
    return `xhs_post_metadata_${url}`;
  }

  static searchResults(keyword: string, page: number = 1): string {
    return `xhs_search_${keyword}_page_${page}`;
  }

  static timeFilter(timeStr: string): string {
    return `xhs_time_filter_${timeStr}`;
  }

  static keywordMatch(title: string, keywords: string[]): string {
    const keywordHash = Buffer.from(keywords.join(',')).toString('base64').slice(0, 8);
    return `xhs_keyword_match_${keywordHash}_${Buffer.from(title).toString('base64').slice(0, 16)}`;
  }
}

/**
 * 帖子处理统计
 */
interface ProcessingStats {
  totalPosts: number;
  duplicatePosts: number;
  keywordMatches: number;
  timeFiltered: number;
  newPostsSent: number;
  cacheHits: number;
  processingTime: number;
  errors: number;
}

/**
 * 批量处理配置
 */
interface BatchProcessConfig {
  batchSize: number;
  concurrency: number;
  delayBetweenBatches: number;
  enableCaching: boolean;
  cacheTimeouts: {
    postContent: number;
    searchResults: number;
    timeFilter: number;
    keywordMatch: number;
  };
}

/**
 * 高性能小红书监控服务
 * 
 * 优化特性：
 * - 多层智能缓存
 * - 批量并发处理
 * - 时间过滤优化
 * - 关键词匹配缓存
 * - 去重算法优化
 * - 性能监控和指标
 */
export class OptimizedXhsService {
  private logger: LoggerInstance;
  private statusManager: StatusManager<string[]>;
  private config: {
    searchKeyword: string;
    matchKeywords: string[];
    seenPostsFile: string;
    maxSeenPosts: number;
  };

  // 性能统计
  private stats: ProcessingStats = {
    totalPosts: 0,
    duplicatePosts: 0,
    keywordMatches: 0,
    timeFiltered: 0,
    newPostsSent: 0,
    cacheHits: 0,
    processingTime: 0,
    errors: 0
  };

  // 批量处理配置
  private batchConfig: BatchProcessConfig = {
    batchSize: 10,
    concurrency: 3,
    delayBetweenBatches: 500,
    enableCaching: true,
    cacheTimeouts: {
      postContent: 10 * 60 * 1000,    // 10分钟
      searchResults: 5 * 60 * 1000,   // 5分钟
      timeFilter: 30 * 60 * 1000,     // 30分钟
      keywordMatch: 60 * 60 * 1000    // 1小时
    }
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
   * 高性能处理小红书帖子数据
   */
  async processPosts(posts: XhsPostData[]): Promise<void> {
    const startTime = Date.now();
    this.logger.info(`🚀 开始高性能处理 ${posts.length} 个帖子`);

    try {
      // 重置统计
      this.resetStats();
      this.stats.totalPosts = posts.length;

      // 预热缓存
      await this.warmupCache(posts);

      // 获取已推送帖子列表
      const seenPosts = this.statusManager.get();
      this.logger.info(`📋 当前去重列表包含 ${seenPosts.length} 个已推送帖子`);

      // 批量并发处理
      const results = await this.batchProcessPosts(posts, seenPosts);

      // 更新状态
      await this.updateStatus(seenPosts, results);

      // 输出统计信息
      this.stats.processingTime = Date.now() - startTime;
      this.outputProcessingStats();

    } catch (error) {
      this.logger.error('❌ 高性能帖子处理失败:', error);
      this.stats.errors++;
      throw error;
    }
  }

  /**
   * 预热缓存
   */
  private async warmupCache(posts: XhsPostData[]): Promise<void> {
    if (!this.batchConfig.enableCaching) return;

    this.logger.info('🔥 预热帖子缓存...');

    const warmupItems = posts.slice(0, 20).map(post => ({
      key: CacheKeyGenerator.postMetadata(post.url),
      fn: async () => ({
        title: post.previewTitle,
        url: post.url,
        publishTime: post.publishTime,
        author: post.author
      }),
      ttl: this.batchConfig.cacheTimeouts.postContent
    }));

    await globalCache.warmup(warmupItems);
    this.logger.info(`✅ 缓存预热完成，预加载 ${warmupItems.length} 个帖子元数据`);
  }

  /**
   * 批量并发处理帖子
   */
  private async batchProcessPosts(posts: XhsPostData[], seenPosts: string[]): Promise<XhsPostData[]> {
    const validPosts: XhsPostData[] = [];
    
    this.logger.info(`📦 开始批量处理，批次大小: ${this.batchConfig.batchSize}, 并发数: ${this.batchConfig.concurrency}`);

    // 分批处理
    for (let i = 0; i < posts.length; i += this.batchConfig.batchSize) {
      const batch = posts.slice(i, i + this.batchConfig.batchSize);
      this.logger.debug(`🔄 处理批次 ${Math.floor(i / this.batchConfig.batchSize) + 1}/${Math.ceil(posts.length / this.batchConfig.batchSize)}`);

      // 并发处理当前批次
      const batchPromises = batch.map(post => this.processSinglePostOptimized(post, seenPosts));
      const batchResults = await Promise.allSettled(batchPromises);

      // 收集成功的结果
      batchResults.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value) {
          validPosts.push(result.value);
        } else if (result.status === 'rejected') {
          this.logger.error(`❌ 处理帖子失败: ${batch[index].previewTitle}`, result.reason);
          this.stats.errors++;
        }
      });

      // 批次间延迟
      if (i + this.batchConfig.batchSize < posts.length) {
        await this.sleep(this.batchConfig.delayBetweenBatches);
      }
    }

    this.logger.info(`✅ 批量处理完成，有效帖子: ${validPosts.length}/${posts.length}`);
    return validPosts;
  }

  /**
   * 优化的单帖子处理
   */
  private async processSinglePostOptimized(post: XhsPostData, seenPosts: string[]): Promise<XhsPostData | null> {
    try {
      // 1. 去重检查（优化：使用Set进行O(1)查找）
      if (this.isDuplicate(post.url, seenPosts)) {
        this.stats.duplicatePosts++;
        return null;
      }

      // 2. 时间过滤（缓存优化）
      if (!(await this.isPostWithin5HoursCached(post.publishTime))) {
        this.stats.timeFiltered++;
        return null;
      }

      // 3. 关键词匹配（缓存优化）
      if (!(await this.matchesKeywordsCached(post.previewTitle))) {
        return null;
      }

      this.stats.keywordMatches++;
      return post;

    } catch (error) {
      this.logger.error(`❌ 处理单个帖子失败: ${post.previewTitle}`, error);
      this.stats.errors++;
      return null;
    }
  }

  /**
   * 优化的去重检查
   */
  private isDuplicate(url: string, seenPosts: string[]): boolean {
    // 使用Set进行O(1)查找而不是数组的O(n)查找
    const seenPostsSet = new Set(seenPosts);
    return seenPostsSet.has(url);
  }

  /**
   * 缓存优化的时间过滤
   */
  private async isPostWithin5HoursCached(publishTime: string): Promise<boolean> {
    if (!this.batchConfig.enableCaching) {
      return this.isPostWithin5Hours(publishTime);
    }

    const cacheKey = CacheKeyGenerator.timeFilter(publishTime);
    
    // 检查缓存
    const cached = globalCache.get(cacheKey);
    if (cached !== undefined) {
      this.stats.cacheHits++;
      return cached;
    }

    // 计算并缓存结果
    const result = this.isPostWithin5Hours(publishTime);
    globalCache.set(cacheKey, result, this.batchConfig.cacheTimeouts.timeFilter);
    
    return result;
  }

  /**
   * 缓存优化的关键词匹配
   */
  private async matchesKeywordsCached(title: string): Promise<boolean> {
    if (!this.batchConfig.enableCaching) {
      return this.matchesKeywords(title);
    }

    const cacheKey = CacheKeyGenerator.keywordMatch(title, this.config.matchKeywords);
    
    // 检查缓存
    const cached = globalCache.get(cacheKey);
    if (cached !== undefined) {
      this.stats.cacheHits++;
      return cached;
    }

    // 计算并缓存结果
    const result = this.matchesKeywords(title);
    globalCache.set(cacheKey, result, this.batchConfig.cacheTimeouts.keywordMatch);
    
    return result;
  }

  /**
   * 更新状态（优化版）
   */
  private async updateStatus(seenPosts: string[], validPosts: XhsPostData[]): Promise<void> {
    let newPostsSent = 0;

    // 批量发送通知
    for (const post of validPosts) {
      try {
        await this.sendNotification(post);
        seenPosts.push(post.url);
        newPostsSent++;
        this.logger.success(`✅ 帖子推送成功: ${post.previewTitle}`);
      } catch (error) {
        this.logger.error(`❌ 推送帖子失败: ${post.previewTitle}`, error);
        this.stats.errors++;
      }
    }

    this.stats.newPostsSent = newPostsSent;

    // 状态管理优化
    if (newPostsSent > 0) {
      // 限制已推送列表大小
      if (seenPosts.length > this.config.maxSeenPosts) {
        const removeCount = seenPosts.length - this.config.maxSeenPosts;
        seenPosts.splice(0, removeCount);
        this.logger.info(`🗑️ 清理旧记录 ${removeCount} 条，保持列表大小在 ${this.config.maxSeenPosts} 以内`);
      }

      this.statusManager.set(seenPosts);
      
      // GitHub Actions环境强制立即保存
      const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';
      if (isGitHubActions) {
        this.statusManager.save();
        this.logger.info(`📝 GitHub Actions环境：强制立即保存状态文件，新增 ${newPostsSent} 条记录`);
        
        // 验证保存结果
        try {
          const savedData = this.statusManager.get();
          this.logger.info(`📝 验证保存结果：当前记录数 ${savedData.length}`);
        } catch (error) {
          this.logger.error('📝 验证保存结果失败:', error);
        }
      } else {
        this.statusManager.save();
        this.logger.info(`📝 状态文件已更新，新增 ${newPostsSent} 条记录`);
      }
    } else {
      this.statusManager.set(seenPosts);
      this.statusManager.save();
      this.logger.info('📝 无新的成功推送，但已确保状态文件同步');
    }
  }

  /**
   * 输出处理统计
   */
  private outputProcessingStats(): void {
    const cacheHitRate = this.stats.totalPosts > 0 ? (this.stats.cacheHits / this.stats.totalPosts * 100) : 0;
    const processingRate = this.stats.totalPosts > 0 ? (this.stats.totalPosts / (this.stats.processingTime / 1000)) : 0;

    this.logger.info(`📊 XHS高性能处理统计:`);
    this.logger.info(`   ⏱️  总处理时间: ${this.stats.processingTime}ms`);
    this.logger.info(`   📝 总帖子数: ${this.stats.totalPosts}`);
    this.logger.info(`   🔄 重复帖子: ${this.stats.duplicatePosts}`);
    this.logger.info(`   ⏰ 时间过滤: ${this.stats.timeFiltered}`);
    this.logger.info(`   🎯 关键词匹配: ${this.stats.keywordMatches}`);
    this.logger.info(`   📱 新帖推送: ${this.stats.newPostsSent}`);
    this.logger.info(`   📋 缓存命中: ${this.stats.cacheHits} (${cacheHitRate.toFixed(1)}%)`);
    this.logger.info(`   ❌ 错误数量: ${this.stats.errors}`);
    this.logger.info(`   ⚡ 处理速度: ${processingRate.toFixed(2)} 帖子/秒`);
  }

  /**
   * 重置统计
   */
  private resetStats(): void {
    this.stats = {
      totalPosts: 0,
      duplicatePosts: 0,
      keywordMatches: 0,
      timeFiltered: 0,
      newPostsSent: 0,
      cacheHits: 0,
      processingTime: 0,
      errors: 0
    };
  }

  /**
   * 检查帖子是否在5小时内（原有逻辑）
   */
  private isPostWithin5Hours(publishTime: string): boolean {
    const now = new Date();
    const fiveHoursAgo = new Date(now.getTime() - 5 * 60 * 60 * 1000);

    // 处理 "刚刚" 和 "分钟前"
    if (publishTime.includes('刚刚') || publishTime.includes('分钟前')) {
      return true;
    }

    // 处理 "X小时前" 格式
    const hoursMatch = publishTime.match(/(\d+)小时前/);
    if (hoursMatch) {
      const hours = parseInt(hoursMatch[1]);
      return hours <= 5;
    }

    // 处理 "今天" 格式
    if (publishTime.includes('今天')) {
      return true; // 今天的帖子可能在5小时内
    }

    // 处理 "昨天" 和 "前天" 格式
    if (publishTime.includes('昨天') || publishTime.includes('前天')) {
      return false;
    }

    // 处理 "X天前" 格式
    const daysMatch = publishTime.match(/(\d+)天前/);
    if (daysMatch) {
      return false; // 天前的都超过5小时
    }

    // 处理 "MM-DD" 格式
    const dateMatch = publishTime.match(/(\d{1,2})-(\d{1,2})/);
    if (dateMatch) {
      return false; // 具体日期的都是较早的帖子
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
   * 检查标题是否匹配关键词（原有逻辑）
   */
  private matchesKeywords(title: string): boolean {
    const titleLower = title.toLowerCase();
    return this.config.matchKeywords.some(keyword => 
      titleLower.includes(keyword.toLowerCase())
    );
  }

  /**
   * 发送通知（原有逻辑）
   */
  private async sendNotification(post: XhsPostData): Promise<void> {
    const message = this.formatMessage(post);
    await sendTelegramMessage(message);
  }

  /**
   * 格式化消息（原有逻辑）
   */
  private formatMessage(post: XhsPostData): string {
    const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    
    return `🔍 小红书监控提醒

📝 标题: ${post.previewTitle}
👤 作者: ${post.author}
🕐 发布时间: ${post.publishTime}
🔗 链接: ${post.url}
📅 检测时间: ${timestamp}

#小红书 #labubu #监控`;
  }

  /**
   * 睡眠函数
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 获取性能统计
   */
  getPerformanceStats(): ProcessingStats {
    return { ...this.stats };
  }

  /**
   * 设置批量处理配置
   */
  setBatchConfig(config: Partial<BatchProcessConfig>): void {
    this.batchConfig = { ...this.batchConfig, ...config };
    this.logger.info(`🔧 XHS批量处理配置已更新:`, this.batchConfig);
  }

  /**
   * 清理缓存
   */
  clearCache(): void {
    globalCache.clear();
    httpCache.clear();
    this.logger.info('🗑️ XHS缓存已清理');
  }
}
