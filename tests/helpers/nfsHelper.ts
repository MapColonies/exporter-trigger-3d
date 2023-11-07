import fs from 'fs';
import path from 'path';
import { randSentence } from '@ngneat/falso';
import { NFSConfig } from '../../src/common/interfaces';

export class NFSHelper {
  public constructor(private readonly config: NFSConfig) {}

  public async createFileOfModel(modelName: string, file: string): Promise<string> {
    const subFolders = path.dirname(file);
    const fileName = path.basename(file);
    const dirPath = `${this.config.pvPath}/${modelName}/${subFolders}`;
    if (!fs.existsSync(dirPath)) {
      await this.createFolder(dirPath);
    }
    const data = randSentence();
    await fs.promises.writeFile(`${dirPath}/${fileName}`, data);
    return data;
  }

  public async createFolder(path: string): Promise<void> {
    await fs.promises.mkdir(path, { recursive: true });
  }

  public async readFile(path: string): Promise<Buffer> {
    return fs.promises.readFile(`${this.config.pvPath}/${path}`);
  }

  public async cleanNFS(): Promise<void> {
    await fs.promises.rm(this.config.pvPath, { recursive: true });
  }

  public initNFS(): void {
    fs.mkdirSync(this.config.pvPath);
  }
}
