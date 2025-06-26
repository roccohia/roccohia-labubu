import fs from 'fs';
import path from 'path';
import { LoggerInstance } from './logger';

/**
 * 一个通用的状态管理器，用于处理JSON文件的读写和更新。
 * 包含完善的错误处理、备份机制和数据验证。
 * @template T - 状态对象的类型
 */
export class StatusManager<T> {
  private filePath: string;
  private backupPath: string;
  private logger: LoggerInstance;
  private data: T;
  private saveTimeout: NodeJS.Timeout | null = null;
  private readonly maxBackups: number = 3;

  constructor(filePath: string, logger: LoggerInstance, initialData: T) {
    this.filePath = filePath;
    this.backupPath = `${filePath}.backup`;
    this.logger = logger;
    this.data = this.load(initialData);

    // 确保目录存在
    this.ensureDirectoryExists();

    // 在GitHub Actions环境中设置进程退出时的强制保存
    const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';
    if (isGitHubActions) {
      this.setupGitHubActionsExitHandlers();
    }
  }

  /**
   * 设置GitHub Actions环境的退出处理器
   */
  private setupGitHubActionsExitHandlers(): void {
    const forceExit = () => {
      try {
        this.logger.info(`🔄 进程退出前强制保存状态: ${this.filePath}`);
        this.save();
        this.logger.info(`✅ 退出前保存完成: ${this.filePath}`);
      } catch (error) {
        this.logger.error(`❌ 退出前保存失败: ${this.filePath}`, error);
      }
    };

    // 监听各种退出信号
    process.on('exit', forceExit);
    process.on('SIGINT', forceExit);
    process.on('SIGTERM', forceExit);
    process.on('beforeExit', forceExit);
  }

  /**
   * 确保文件所在目录存在
   */
  private ensureDirectoryExists(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        this.logger.info(`创建目录: ${dir}`);
      }
    } catch (error) {
      this.logger.error('创建目录失败', error);
    }
  }

  /**
   * 从文件加载状态，包含备份恢复机制
   * @param initialData - 初始数据
   * @returns 加载的数据
   */
  private load(initialData: T): T {
    // 首先尝试加载主文件
    const mainData = this.tryLoadFile(this.filePath);
    if (mainData !== null) {
      this.logger.info(`成功加载状态文件: ${this.filePath}`);
      return mainData;
    }

    // 如果主文件失败，尝试加载备份文件
    this.logger.warn(`主文件加载失败，尝试加载备份文件: ${this.backupPath}`);
    const backupData = this.tryLoadFile(this.backupPath);
    if (backupData !== null) {
      this.logger.success(`成功从备份文件恢复数据: ${this.backupPath}`);
      // 恢复主文件
      this.saveToFile(this.filePath, backupData);
      return backupData;
    }

    // 如果都失败了，使用初始数据
    this.logger.warn(`所有文件加载失败，使用初始数据`);
    return initialData;
  }

  /**
   * 尝试加载单个文件
   * @param filePath - 文件路径
   * @returns 解析的数据或 null（如果失败）
   */
  private tryLoadFile(filePath: string): T | null {
    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const fileContent = fs.readFileSync(filePath, 'utf-8');
      if (!fileContent.trim()) {
        this.logger.warn(`文件为空: ${filePath}`);
        return null;
      }

      const data = JSON.parse(fileContent);

      // 基本数据验证
      if (data === null || data === undefined) {
        this.logger.warn(`文件包含无效数据: ${filePath}`);
        return null;
      }

      return data;
    } catch (error) {
      this.logger.error(`读取或解析文件失败: ${filePath}`, error);
      return null;
    }
  }

  /**
   * 获取当前所有状态数据
   * @returns 状态数据
   */
  public get(): T {
    return this.data;
  }

  /**
   * 更新状态数据
   * @param newData - 新的数据
   */
  public set(newData: T): void {
    this.data = newData;
    this.debouncedSave();
  }

  /**
   * 防抖保存，避免频繁写入
   */
  private debouncedSave(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    this.saveTimeout = setTimeout(() => this.save(), 500);
  }

  /**
   * 将当前状态写入文件，包含备份机制
   */
  public save(): void {
    try {
      // 清除防抖定时器，确保立即保存
      if (this.saveTimeout) {
        clearTimeout(this.saveTimeout);
        this.saveTimeout = null;
      }

      // 创建备份（如果主文件存在）
      if (fs.existsSync(this.filePath)) {
        this.createBackup();
      }

      // 保存到主文件
      this.saveToFile(this.filePath, this.data);

      // 在GitHub Actions环境中进行额外验证
      const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';
      if (isGitHubActions) {
        this.verifyGitHubActionsSave();
      }

      this.logger.info(`状态已成功保存到 ${this.filePath}`);

    } catch (error) {
      this.logger.error(`保存状态失败`, error);
      throw error;
    }
  }

  /**
   * GitHub Actions环境中的保存验证
   */
  private verifyGitHubActionsSave(): void {
    try {
      // 验证文件是否存在
      if (!fs.existsSync(this.filePath)) {
        throw new Error(`文件保存后不存在: ${this.filePath}`);
      }

      // 验证文件内容
      const savedContent = fs.readFileSync(this.filePath, 'utf-8');
      const parsedData = JSON.parse(savedContent);

      // 验证数据完整性
      if (Array.isArray(this.data) && Array.isArray(parsedData)) {
        if (parsedData.length !== this.data.length) {
          throw new Error(`数据长度不匹配: 期望 ${this.data.length}, 实际 ${parsedData.length}`);
        }
      }

      this.logger.info(`✅ GitHub Actions保存验证通过: ${this.filePath}`);
      this.logger.debug(`📊 文件大小: ${savedContent.length} 字节`);

      if (Array.isArray(parsedData)) {
        this.logger.debug(`📊 数组长度: ${parsedData.length} 项`);
      }

    } catch (error) {
      this.logger.error('❌ GitHub Actions保存验证失败:', error);
      throw error;
    }
  }

  /**
   * 保存数据到指定文件
   * @param filePath - 文件路径
   * @param data - 要保存的数据
   */
  private saveToFile(filePath: string, data: T): void {
    const jsonString = JSON.stringify(data, null, 2);

    // 原子写入：先写入临时文件，然后重命名
    const tempPath = `${filePath}.tmp`;

    try {
      fs.writeFileSync(tempPath, jsonString, 'utf-8');

      // 验证写入的文件
      const verification = fs.readFileSync(tempPath, 'utf-8');
      JSON.parse(verification); // 确保可以解析

      // 原子重命名
      fs.renameSync(tempPath, filePath);

    } catch (error) {
      // 清理临时文件
      if (fs.existsSync(tempPath)) {
        try {
          fs.unlinkSync(tempPath);
        } catch (cleanupError) {
          this.logger.warn(`清理临时文件失败: ${tempPath}`, cleanupError);
        }
      }
      throw error;
    }
  }

  /**
   * 创建备份文件
   */
  private createBackup(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        fs.copyFileSync(this.filePath, this.backupPath);
        this.logger.debug(`创建备份文件: ${this.backupPath}`);
      }
    } catch (error) {
      this.logger.warn(`创建备份文件失败`, error);
    }
  }

  /**
   * 获取文件统计信息
   */
  public getFileStats(): { exists: boolean; size?: number; lastModified?: Date } {
    try {
      if (fs.existsSync(this.filePath)) {
        const stats = fs.statSync(this.filePath);
        return {
          exists: true,
          size: stats.size,
          lastModified: stats.mtime
        };
      }
    } catch (error) {
      this.logger.warn(`获取文件统计信息失败`, error);
    }

    return { exists: false };
  }
} 