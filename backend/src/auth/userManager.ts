import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import pino from 'pino';
import { config } from '../config.js';

const logger = pino({ name: 'user-manager', level: config.LOG_LEVEL });

export type UserRole = 'ADMIN' | 'OPERATOR' | 'VIEWER';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  passwordHash: string;
  createdAt: string;
  updatedAt: string;
}

export type SafeUser = Omit<User, 'passwordHash'>;

class UserManager {
  private users: Map<string, User> = new Map();
  private filePath: string;

  constructor() {
    this.filePath = path.join(config.AUTH_DIR, 'users.json');
    this.ensureAuthDir();
    this.loadUsers();
  }

  private ensureAuthDir() {
    if (!fs.existsSync(config.AUTH_DIR)) {
      fs.mkdirSync(config.AUTH_DIR, { recursive: true });
    }
  }

  private hashPassword(password: string): string {
    return crypto.createHash('sha256').update(password).digest('hex');
  }

  private saveUsers() {
    try {
      const list = Array.from(this.users.values());
      fs.writeFileSync(this.filePath, JSON.stringify(list, null, 2), 'utf-8');
    } catch (err: any) {
      logger.error({ err: err.message }, 'Erro ao salvar users.json');
    }
  }

  private loadUsers() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const list: User[] = JSON.parse(raw);
        if (Array.isArray(list)) {
          for (const u of list) {
            this.users.set(u.id, u);
          }
          logger.info(`Carregados ${this.users.size} usuários do disco.`);
        }
      }
    } catch (err: any) {
      logger.warn({ err: err.message }, 'Falha ao ler users.json');
    }

    // Garante que exista ao menos 1 ADMIN inicial padrão
    if (this.users.size === 0) {
      const adminId = 'usr_admin_01';
      const defaultAdmin: User = {
        id: adminId,
        name: 'Administrador Master',
        email: 'admin@dlm.com',
        role: 'ADMIN',
        passwordHash: this.hashPassword('admin123'),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      this.users.set(adminId, defaultAdmin);
      this.saveUsers();
      logger.info('Usuário Administrador inicial criado (admin@dlm.com / admin123).');
    }
  }

  private toSafeUser(user: User): SafeUser {
    const { passwordHash, ...safe } = user;
    return safe;
  }

  public getAll(): SafeUser[] {
    return Array.from(this.users.values()).map((u) => this.toSafeUser(u));
  }

  public getById(id: string): SafeUser | null {
    const u = this.users.get(id);
    return u ? this.toSafeUser(u) : null;
  }

  public getByEmail(email: string): User | null {
    const clean = email.trim().toLowerCase();
    for (const u of this.users.values()) {
      if (u.email.toLowerCase() === clean) {
        return u;
      }
    }
    return null;
  }

  public register(name: string, email: string, password?: string, role: UserRole = 'OPERATOR'): SafeUser {
    const cleanEmail = email.trim().toLowerCase();
    if (this.getByEmail(cleanEmail)) {
      throw new Error(`O e-mail "${cleanEmail}" já está cadastrado.`);
    }

    const id = `usr_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const now = new Date().toISOString();
    const newUser: User = {
      id,
      name: name.trim(),
      email: cleanEmail,
      // Novos usuários por padrão sempre entram como OPERATOR a menos que admin crie explicitamente
      role: role || 'OPERATOR',
      passwordHash: this.hashPassword(password || '123456'),
      createdAt: now,
      updatedAt: now,
    };

    this.users.set(id, newUser);
    this.saveUsers();
    logger.info(`Novo usuário cadastrado: ${newUser.name} (${newUser.email}) com papel [${newUser.role}]`);
    return this.toSafeUser(newUser);
  }

  public updateRole(userId: string, newRole: UserRole, callerId?: string): SafeUser {
    const user = this.users.get(userId);
    if (!user) {
      throw new Error('Usuário não encontrado.');
    }

    // Não permite rebaixar o único admin do sistema
    if (user.role === 'ADMIN' && newRole !== 'ADMIN') {
      const adminCount = Array.from(this.users.values()).filter((u) => u.role === 'ADMIN').length;
      if (adminCount <= 1) {
        throw new Error('Não é permitido rebaixar o único Administrador do sistema.');
      }
    }

    user.role = newRole;
    user.updatedAt = new Date().toISOString();
    this.saveUsers();
    logger.info(`Papel do usuário ${user.email} alterado para [${newRole}] por ${callerId || 'sistema'}`);
    return this.toSafeUser(user);
  }

  public deleteUser(userId: string, callerId?: string): boolean {
    const user = this.users.get(userId);
    if (!user) return false;

    if (user.role === 'ADMIN') {
      const adminCount = Array.from(this.users.values()).filter((u) => u.role === 'ADMIN').length;
      if (adminCount <= 1) {
        throw new Error('Não é possível remover o único Administrador do sistema.');
      }
    }

    if (callerId && callerId === userId) {
      throw new Error('Não é permitido excluir sua própria conta enquanto conectado.');
    }

    this.users.delete(userId);
    this.saveUsers();
    logger.info(`Usuário ${user.email} excluído por ${callerId || 'sistema'}`);
    return true;
  }

  public authenticate(email: string, password?: string): SafeUser | null {
    const user = this.getByEmail(email);
    if (!user) return null;

    if (password) {
      const hash = this.hashPassword(password);
      if (hash !== user.passwordHash) {
        return null;
      }
    }

    return this.toSafeUser(user);
  }
}

export const userManager = new UserManager();
