/**
 * Map MySQL / network errors to a safe client message and HTTP status.
 */
export function mapDbError(err) {
  const code = err?.code;
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND') {
    return { status: 503, message: 'Database server is unreachable. Start MySQL and check DB_HOST in server/.env.' };
  }
  if (code === 'ER_ACCESS_DENIED_ERROR' || code === 'ER_DBACCESS_DENIED_ERROR') {
    const pw = process.env.DB_PASSWORD ?? '';
    const emptyPw = pw.length === 0;
    const hint = emptyPw
      ? 'DB_PASSWORD is empty in server/.env. If your MySQL user has a password, set DB_PASSWORD to that exact value, save, and restart the API. If the password contains # or =, wrap it in double quotes, e.g. DB_PASSWORD="your#pass".'
      : 'Verify DB_USER and DB_PASSWORD match a MySQL account that can log in (try mysql -u USER -p). On Windows, try DB_HOST=127.0.0.1. Run: node server/db/test-connection.js';
    const detail = err.sqlMessage ? ` (${err.sqlMessage})` : '';
    return { status: 503, message: `Database access denied. ${hint}${detail}` };
  }
  if (code === 'ER_BAD_DB_ERROR') {
    return { status: 503, message: 'Database does not exist. Run database/schema.sql and set DB_NAME in server/.env.' };
  }
  if (code === 'ER_NO_SUCH_TABLE') {
    return { status: 503, message: 'Database tables are missing. Run: mysql ... < database/schema.sql' };
  }
  if (err?.name === 'JsonWebTokenError' || err?.name === 'TokenExpiredError') {
    return { status: 500, message: 'Token signing failed. Set JWT_SECRET and JWT_REFRESH_SECRET in server/.env.' };
  }
  return {
    status: 500,
    message:
      process.env.NODE_ENV === 'development'
        ? err?.message || 'Server error'
        : 'Server error. Check the terminal where the API is running for details.',
  };
}
