import fs from 'fs';
import { Logger } from './logger';

/**
 * 一个通用的状态管理器，用于处理JSON文件的读写和更新。
 * @template T - 状态对象的类型
 */
export class StatusManager<T> {
  private filePath: string;
  private logger: Logger;
  private data: T;
  private saveTimeout: NodeJS.Timeout | null = null;

  constructor(filePath: string, logger: Logger, initialData: T) {
    this.filePath = filePath;
    this.logger = logger;
    this.data = this.load(initialData);
  }

  /**
   * 从文件加载状态，如果文件不存在或出错，则返回初始数据。
   * @param initialData - 初始数据
   * @returns 加载的数据
   */
  private load(initialData: T): T {
    if (fs.existsSync(this.filePath)) {
      try {
        const fileContent = fs.readFileSync(this.filePath, 'utf-8');
        return JSON.parse(fileContent);
      } catch (e) {
        this.logger.error(`读取或解析 ${this.filePath} 文件失败，将使用初始数据。`);
        return initialData;
      }
    }
    return initialData;
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

  private debouncedSave() {
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    this.saveTimeout = setTimeout(() => this.save(), 500);
  }
  
  /**
   * 将当前状态写入文件
   */
  public save(): void {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
      this.logger.info(`状态已成功保存到 ${this.filePath}`);
    } catch(e) {
      this.logger.error(`保存状态到 ${this.filePath} 时出错: ${e}`);
    }
  }
} 