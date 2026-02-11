import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.join(__dirname, '..');
const STATS_FILE = path.join(PROJECT_ROOT, 'account_stats.json');

/**
 * Account Manager - Manages YouTube account statistics and selection
 */
class AccountManager {
    constructor() {
        this.stats = this.loadStats();
    }

    /**
     * Load account statistics from file
     */
    loadStats() {
        if (!fs.existsSync(STATS_FILE)) {
            console.warn('⚠️  account_stats.json not found, creating empty stats');
            return {};
        }

        try {
            const data = fs.readFileSync(STATS_FILE, 'utf8');
            return JSON.parse(data);
        } catch (err) {
            console.error('Error reading account stats:', err);
            return {};
        }
    }

    /**
     * Save account statistics to file
     */
    saveStats() {
        try {
            fs.writeFileSync(STATS_FILE, JSON.stringify(this.stats, null, 2), 'utf8');
        } catch (err) {
            console.error('Error saving account stats:', err);
        }
    }

    /**
     * Get all accounts sorted by upload count (ascending)
     */
    getAllAccounts() {
        return Object.entries(this.stats)
            .map(([id, data]) => ({ id, ...data }))
            .sort((a, b) => a.upload_count - b.upload_count);
    }

    /**
     * Get account with least uploads
     */
    getLeastUsedAccount() {
        const accounts = this.getAllAccounts();
        if (accounts.length === 0) {
            throw new Error('No accounts configured');
        }
        return accounts[0];
    }

    /**
     * Get specific account by ID
     */
    getAccount(accountId) {
        if (!this.stats[accountId]) {
            throw new Error(`Account ${accountId} not found`);
        }
        return { id: accountId, ...this.stats[accountId] };
    }

    /**
     * Increment upload count for an account
     */
    incrementUploadCount(accountId) {
        if (!this.stats[accountId]) {
            throw new Error(`Account ${accountId} not found`);
        }

        this.stats[accountId].upload_count++;
        this.stats[accountId].last_upload = new Date().toISOString();
        this.saveStats();

        console.log(`✅ Updated ${accountId}: ${this.stats[accountId].upload_count} uploads`);
    }

    /**
     * Add a new account
     */
    addAccount(accountId, name, tokenFile) {
        if (this.stats[accountId]) {
            throw new Error(`Account ${accountId} already exists`);
        }

        this.stats[accountId] = {
            name: name,
            token_file: tokenFile,
            upload_count: 0,
            last_upload: null,
            channel_id: null
        };

        this.saveStats();
        console.log(`✅ Added ${accountId}: ${name}`);
    }

    /**
     * Display account statistics
     */
    displayStats() {
        const accounts = this.getAllAccounts();

        console.log('\n📊 YouTube Account Statistics\n');
        console.log('ID'.padEnd(12) + 'Name'.padEnd(20) + 'Uploads'.padEnd(10) + 'Last Upload');
        console.log('-'.repeat(70));

        for (const account of accounts) {
            const lastUpload = account.last_upload
                ? new Date(account.last_upload).toLocaleString('ko-KR')
                : 'Never';

            console.log(
                account.id.padEnd(12) +
                account.name.padEnd(20) +
                account.upload_count.toString().padEnd(10) +
                lastUpload
            );
        }

        console.log('');
    }

    /**
     * Get next available account ID
     */
    getNextAccountId() {
        const accountIds = Object.keys(this.stats);
        const numbers = accountIds
            .filter(id => id.startsWith('account'))
            .map(id => parseInt(id.replace('account', '')))
            .filter(n => !isNaN(n));

        const maxNum = numbers.length > 0 ? Math.max(...numbers) : 0;
        return `account${maxNum + 1}`;
    }
}

// Export for use in other scripts
export default AccountManager;

// CLI usage
if (import.meta.url === `file://${process.argv[1]}`) {
    const manager = new AccountManager();

    const command = process.argv[2];

    if (command === 'stats' || !command) {
        manager.displayStats();
    } else if (command === 'least') {
        const account = manager.getLeastUsedAccount();
        console.log(`🎯 Least used account: ${account.id} (${account.name}) - ${account.upload_count} uploads`);
    } else if (command === 'add') {
        const name = process.argv[3];
        const tokenFile = process.argv[4];

        if (!name || !tokenFile) {
            console.error('Usage: node account_manager.js add <name> <token_file>');
            process.exit(1);
        }

        const accountId = manager.getNextAccountId();
        manager.addAccount(accountId, name, tokenFile);
    } else {
        console.log('Usage:');
        console.log('  node scripts/account_manager.js stats    - Display account statistics');
        console.log('  node scripts/account_manager.js least    - Show least used account');
        console.log('  node scripts/account_manager.js add <name> <token_file> - Add new account');
    }
}
