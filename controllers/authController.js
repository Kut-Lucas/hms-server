// import bcrypt from 'bcrypt';
// import crypto from 'crypto';
// import { pool } from '../db/pool.js';
// import { auditLog } from '../utils/auditLog.js';
// import { mapDbError } from '../utils/dbErrors.js';
// import { signAccessToken, signRefreshToken, verifyRefreshToken, hashToken } from '../utils/jwt.js';
// import { sendPasswordChangedEmail } from '../utils/mailer.js';

// const SALT = 10;

// function clientIp(req) {
//   return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || null;
// }

// export async function register(req, res) {
//   try {
//     const { full_name, email, password } = req.body;
//     if (!full_name || !email || !password) {
//       return res.status(400).json({ success: false, message: 'Missing required fields' });
//     }
//     if (password.length < 8) {
//       return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
//     }
//     const hash = await bcrypt.hash(password, SALT);
//     await pool.execute(
//       `INSERT INTO users (full_name, email, password_hash, role, is_approved, is_active)
//        VALUES (?, ?, ?, 'receptionist', FALSE, TRUE)`,
//       [full_name.trim(), email.trim().toLowerCase(), hash]
//     );
//     await auditLog(null, 'USER_REGISTER', 'users', null, { email }, clientIp(req));
//     return res.status(201).json({
//       success: true,
//       message: 'Registration successful. Pending admin approval before you can log in.',
//     });
//   } catch (e) {
//     if (e.code === 'ER_DUP_ENTRY') {
//       return res.status(400).json({ success: false, message: 'Email already registered' });
//     }
//     console.error(e);
//     const { status, message } = mapDbError(e);
//     return res.status(status).json({ success: false, message });
//   }
// }

// export async function login(req, res) {
//   try {
//     const { email, password } = req.body;
//     if (!email || !password) {
//       return res.status(400).json({ success: false, message: 'Email and password required' });
//     }
//     const [rows] = await pool.execute(
//       `SELECT id, full_name, email, password_hash, role, is_approved, is_active FROM users WHERE email = ?`,
//       [email.trim().toLowerCase()]
//     );
//     const user = rows[0];
//     const hashOk =
//       user?.password_hash &&
//       typeof user.password_hash === 'string' &&
//       (await bcrypt.compare(password, user.password_hash).catch(() => false));
//     if (!user || !hashOk) {
//       await auditLog(null, 'LOGIN_FAILED', 'users', null, { email }, clientIp(req));
//       return res.status(401).json({ success: false, message: 'Invalid credentials' });
//     }
//     if (!user.is_active) {
//       return res.status(403).json({ success: false, message: 'Account deactivated' });
//     }
//     if (!user.is_approved) {
//       return res.status(403).json({ success: false, message: 'Account pending admin approval' });
//     }
//     const payload = { id: user.id, email: user.email, role: user.role, full_name: user.full_name };
//     const accessToken = signAccessToken(payload);
//     const refreshToken = signRefreshToken({ id: user.id, type: 'refresh' });
//     const tokenHash = hashToken(refreshToken);
//     const decoded = verifyRefreshToken(refreshToken);
//     const expMs = decoded?.exp ? decoded.exp * 1000 : Date.now() + 7 * 24 * 60 * 60 * 1000;
//     const expiresAt = new Date(expMs);
//     if (Number.isNaN(expiresAt.getTime())) {
//       throw new Error('Invalid refresh token expiry');
//     }
//     await pool.execute(`DELETE FROM refresh_tokens WHERE user_id = ?`, [user.id]);
//     await pool.execute(
//       `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)`,
//       [user.id, tokenHash, expiresAt]
//     );
//     const maxAge = 7 * 24 * 60 * 60 * 1000;
//     res.cookie('refreshToken', refreshToken, {
//       httpOnly: true,
//       secure: process.env.NODE_ENV === 'production',
//       sameSite: 'lax',
//       maxAge,
//       path: '/api/auth',
//     });
//     await auditLog(user.id, 'LOGIN_SUCCESS', 'users', user.id, null, clientIp(req));
//     return res.json({
//       success: true,
//       accessToken,
//       user: { id: user.id, full_name: user.full_name, email: user.email, role: user.role },
//     });
//   } catch (e) {
//     console.error('login error', e);
//     const { status, message } = mapDbError(e);
//     return res.status(status).json({ success: false, message });
//   }
// }

// export async function refresh(req, res) {
//   try {
//     const token = req.cookies?.refreshToken;
//     if (!token) {
//       return res.status(401).json({ success: false, message: 'No refresh token' });
//     }
//     let decoded;
//     try {
//       decoded = verifyRefreshToken(token);
//     } catch {
//       return res.status(401).json({ success: false, message: 'Invalid refresh token' });
//     }
//     if (!decoded?.id) {
//       return res.status(401).json({ success: false, message: 'Invalid refresh token' });
//     }
//     const tokenHash = hashToken(token);
//     const [rows] = await pool.execute(
//       `SELECT rt.user_id, u.email, u.full_name, u.role, u.is_approved, u.is_active
//        FROM refresh_tokens rt
//        JOIN users u ON u.id = rt.user_id
//        WHERE rt.token_hash = ? AND rt.expires_at > NOW()`,
//       [tokenHash]
//     );
//     const row = rows[0];
//     if (!row || !row.is_active || !row.is_approved) {
//       return res.status(401).json({ success: false, message: 'Session invalid' });
//     }
//     const payload = {
//       id: row.user_id,
//       email: row.email,
//       role: row.role,
//       full_name: row.full_name,
//     };
//     const accessToken = signAccessToken(payload);
//     return res.json({ success: true, accessToken, user: payload });
//   } catch (e) {
//     console.error('refresh error', e);
//     const { status, message } = mapDbError(e);
//     return res.status(status).json({ success: false, message });
//   }
// }

// export async function logout(req, res) {
//   try {
//     const token = req.cookies?.refreshToken;
//     if (token) {
//       try {
//         const decoded = verifyRefreshToken(token);
//         const tokenHash = hashToken(token);
//         await pool.execute(`DELETE FROM refresh_tokens WHERE user_id = ? AND token_hash = ?`, [
//           decoded.id,
//           tokenHash,
//         ]);
//       } catch {
//         /* ignore */
//       }
//     }
//     res.clearCookie('refreshToken', { path: '/api/auth' });
//     if (req.user?.id) {
//       await auditLog(req.user.id, 'LOGOUT', 'users', req.user.id, null, clientIp(req));
//     }
//     return res.json({ success: true, message: 'Logged out' });
//   } catch (e) {
//     console.error(e);
//     const { status, message } = mapDbError(e);
//     return res.status(status).json({ success: false, message });
//   }
// }

// /**
//  * POST /auth/reset-password
//  * Body: { email, code, new_password, confirm_password }
//  * Uses the admin-generated one-time code to reset the password.
//  */
// export async function resetPasswordWithCode(req, res) {
//   try {
//     const { email, code, new_password, confirm_password } = req.body;
//     if (!email || !code || !new_password || !confirm_password) {
//       return res.status(400).json({ success: false, message: 'All fields are required' });
//     }
//     if (new_password !== confirm_password) {
//       return res.status(400).json({ success: false, message: 'Passwords do not match' });
//     }
//     if (new_password.length < 8) {
//       return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
//     }

//     const [users] = await pool.execute(
//       `SELECT id, full_name, email FROM users WHERE email = ? AND is_active = TRUE`,
//       [email.trim().toLowerCase()]
//     );
//     const user = users[0];
//     if (!user) {
//       // Generic message to avoid user enumeration
//       return res.status(400).json({ success: false, message: 'Invalid email or code' });
//     }

//     const codeHash = crypto.createHash('sha256').update(code.trim().toUpperCase()).digest('hex');
//     const [codes] = await pool.execute(
//       `SELECT id FROM password_reset_codes
//        WHERE user_id = ? AND code_hash = ? AND expires_at > NOW() AND used = 0
//        LIMIT 1`,
//       [user.id, codeHash]
//     );
//     if (!codes.length) {
//       return res.status(400).json({ success: false, message: 'Invalid or expired code' });
//     }

//     // Mark code used and update password
//     const newHash = await bcrypt.hash(new_password, SALT);
//     await pool.execute(`UPDATE password_reset_codes SET used = 1 WHERE id = ?`, [codes[0].id]);
//     await pool.execute(`UPDATE users SET password_hash = ? WHERE id = ?`, [newHash, user.id]);
//     // Invalidate all refresh tokens so old sessions can't persist
//     await pool.execute(`DELETE FROM refresh_tokens WHERE user_id = ?`, [user.id]);

//     await auditLog(user.id, 'PASSWORD_RESET', 'users', user.id, {}, clientIp(req));

//     // Fire-and-forget email notification
//     sendPasswordChangedEmail({ toEmail: user.email, fullName: user.full_name }).catch((err) =>
//       console.error('[mailer] Failed to send password-changed email:', err)
//     );

//     return res.json({ success: true, message: 'Password changed successfully. You can now log in.' });
//   } catch (e) {
//     console.error('resetPasswordWithCode error', e);
//     const { status, message } = mapDbError(e);
//     return res.status(status).json({ success: false, message });
//   }
// }

// export async function me(req, res) {
//   try {
//     const [rows] = await pool.execute(
//       `SELECT id, full_name, email, role, is_approved, is_active, created_at FROM users WHERE id = ?`,
//       [req.user.id]
//     );
//     const user = rows[0];
//     if (!user) {
//       return res.status(404).json({ success: false, message: 'User not found' });
//     }
//     return res.json({ success: true, user });
//   } catch (e) {
//     console.error(e);
//     const { status, message } = mapDbError(e);
//     return res.status(status).json({ success: false, message });
//   }
// }


import bcrypt from "bcrypt";
import crypto from "crypto";

import { pool } from "../db/pool.js";
import { auditLog } from "../utils/auditLog.js";
import { mapDbError } from "../utils/dbErrors.js";

import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  hashToken,
} from "../utils/jwt.js";

import { sendPasswordChangedEmail } from "../utils/mailer.js";


const SALT = 10;


/*
|--------------------------------------------------------------------------
| CLIENT IP
|--------------------------------------------------------------------------
*/

function clientIp(req) {
  return (
    req.headers["x-forwarded-for"]
      ?.split(",")[0]
      ?.trim() ||
    req.socket?.remoteAddress ||
    null
  );
}


/*
|--------------------------------------------------------------------------
| REGISTER
|--------------------------------------------------------------------------
*/

export async function register(req, res) {
  try {
    const {
      full_name,
      email,
      password,
    } = req.body || {};

    if (
      !full_name ||
      !email ||
      !password
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Missing required fields",
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message:
          "Password must be at least 8 characters",
      });
    }

    const cleanEmail =
      email.trim().toLowerCase();

    const cleanName =
      full_name.trim();

    const hash =
      await bcrypt.hash(
        password,
        SALT
      );

    await pool.execute(
      `INSERT INTO users
        (
          full_name,
          email,
          password_hash,
          role,
          is_approved,
          is_active
        )
       VALUES
        (?, ?, ?, 'receptionist', FALSE, TRUE)`,
      [
        cleanName,
        cleanEmail,
        hash,
      ]
    );

    /*
     * Audit logging should not prevent
     * registration from completing.
     */
    try {
      await auditLog(
        null,
        "USER_REGISTER",
        "users",
        null,
        {
          email: cleanEmail,
        },
        clientIp(req)
      );
    } catch (auditError) {
      console.error(
        "Registration audit log failed:",
        auditError
      );
    }

    return res.status(201).json({
      success: true,
      message:
        "Registration successful. Pending admin approval before you can log in.",
    });

  } catch (e) {

    console.error(
      "REGISTER ERROR:",
      e
    );

    if (
      e.code === "ER_DUP_ENTRY"
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Email already registered",
      });
    }

    const {
      status,
      message,
    } = mapDbError(e);

    return res.status(status).json({
      success: false,
      message,
    });
  }
}


/*
|--------------------------------------------------------------------------
| LOGIN
|--------------------------------------------------------------------------
*/

export async function login(req, res) {

  console.log(
    "======================================"
  );

  console.log(
    "LOGIN REQUEST RECEIVED"
  );

  console.log(
    "Origin:",
    req.headers.origin
  );

  console.log(
    "======================================"
  );


  try {

    const {
      email,
      password,
    } = req.body || {};


    /*
    |--------------------------------------------------------------------------
    | VALIDATE INPUT
    |--------------------------------------------------------------------------
    */

    if (
      !email ||
      !password
    ) {
      console.log(
        "LOGIN FAILED: Missing email/password"
      );

      return res.status(400).json({
        success: false,
        message:
          "Email and password required",
      });
    }


    const cleanEmail =
      email.trim().toLowerCase();


    console.log(
      "Looking up user:",
      cleanEmail
    );


    /*
    |--------------------------------------------------------------------------
    | FIND USER
    |--------------------------------------------------------------------------
    */

    const [rows] =
      await pool.execute(
        `SELECT
          id,
          full_name,
          email,
          password_hash,
          role,
          is_approved,
          is_active
         FROM users
         WHERE email = ?
         LIMIT 1`,
        [cleanEmail]
      );


    const user =
      rows[0];


    console.log(
      "User found:",
      !!user
    );


    /*
    |--------------------------------------------------------------------------
    | PASSWORD CHECK
    |--------------------------------------------------------------------------
    */

    if (!user) {

      console.log(
        "LOGIN FAILED: User does not exist"
      );

      return res.status(401).json({
        success: false,
        message:
          "Invalid credentials",
      });
    }


    if (
      !user.password_hash ||
      typeof user.password_hash !==
        "string"
    ) {

      console.error(
        "LOGIN ERROR: User has no valid password hash"
      );

      return res.status(401).json({
        success: false,
        message:
          "Invalid credentials",
      });
    }


    console.log(
      "Checking password..."
    );


    let passwordMatches = false;

    try {

      passwordMatches =
        await bcrypt.compare(
          password,
          user.password_hash
        );

    } catch (bcryptError) {

      console.error(
        "BCRYPT ERROR:",
        bcryptError
      );

      passwordMatches = false;
    }


    if (!passwordMatches) {

      console.log(
        "LOGIN FAILED: Invalid password"
      );


      /*
       * Audit logging must not prevent
       * the login response.
       */
      try {

        await auditLog(
          null,
          "LOGIN_FAILED",
          "users",
          null,
          {
            email: cleanEmail,
          },
          clientIp(req)
        );

      } catch (auditError) {

        console.error(
          "Failed login audit error:",
          auditError
        );
      }


      return res.status(401).json({
        success: false,
        message:
          "Invalid credentials",
      });
    }


    /*
    |--------------------------------------------------------------------------
    | ACCOUNT STATUS
    |--------------------------------------------------------------------------
    */

    if (!user.is_active) {

      console.log(
        "LOGIN FAILED: Account inactive"
      );

      return res.status(403).json({
        success: false,
        message:
          "Account deactivated",
      });
    }


    if (!user.is_approved) {

      console.log(
        "LOGIN FAILED: Account pending approval"
      );

      return res.status(403).json({
        success: false,
        message:
          "Account pending admin approval",
      });
    }


    console.log(
      "Password correct and account approved."
    );


    /*
    |--------------------------------------------------------------------------
    | CREATE ACCESS TOKEN
    |--------------------------------------------------------------------------
    */

    const payload = {
      id: user.id,
      email: user.email,
      role: user.role,
      full_name: user.full_name,
    };


    const accessToken =
      signAccessToken(
        payload
      );


    /*
    |--------------------------------------------------------------------------
    | CREATE REFRESH TOKEN
    |--------------------------------------------------------------------------
    */

    console.log(
      "Creating refresh token..."
    );


    const refreshToken =
      signRefreshToken({
        id: user.id,
        type: "refresh",
      });


    const tokenHash =
      hashToken(
        refreshToken
      );


    const decoded =
      verifyRefreshToken(
        refreshToken
      );


    const expMs =
      decoded?.exp
        ? decoded.exp * 1000
        : Date.now() +
          7 *
            24 *
            60 *
            60 *
            1000;


    const expiresAt =
      new Date(expMs);


    if (
      Number.isNaN(
        expiresAt.getTime()
      )
    ) {
      throw new Error(
        "Invalid refresh token expiry"
      );
    }


    /*
    |--------------------------------------------------------------------------
    | SAVE REFRESH TOKEN
    |--------------------------------------------------------------------------
    */

    console.log(
      "Deleting old refresh tokens..."
    );


    await pool.execute(
      `DELETE FROM refresh_tokens
       WHERE user_id = ?`,
      [user.id]
    );


    console.log(
      "Saving new refresh token..."
    );


    await pool.execute(
      `INSERT INTO refresh_tokens
        (
          user_id,
          token_hash,
          expires_at
        )
       VALUES
        (?, ?, ?)`,
      [
        user.id,
        tokenHash,
        expiresAt,
      ]
    );


    /*
    |--------------------------------------------------------------------------
    | REFRESH COOKIE
    |--------------------------------------------------------------------------
    |
    | Frontend:
    | https://hms-client-1.onrender.com
    |
    | Backend:
    | https://hms-server-odkt.onrender.com
    |
    | Therefore production uses:
    | secure: true
    | sameSite: "none"
    |
    */

    const isProduction =
      process.env.NODE_ENV ===
      "production";


    const maxAge =
      7 *
      24 *
      60 *
      60 *
      1000;


    res.cookie(
      "refreshToken",
      refreshToken,
      {
        httpOnly: true,

        secure:
          isProduction,

        sameSite:
          isProduction
            ? "none"
            : "lax",

        maxAge,

        path: "/api/auth",

      }
    );


    /*
    |--------------------------------------------------------------------------
    | AUDIT LOGIN
    |--------------------------------------------------------------------------
    */

    try {

      await auditLog(
        user.id,
        "LOGIN_SUCCESS",
        "users",
        user.id,
        null,
        clientIp(req)
      );

    } catch (auditError) {

      /*
       * Do NOT make a successful login
       * fail because audit logging failed.
       */

      console.error(
        "LOGIN AUDIT ERROR:",
        auditError
      );
    }


    /*
    |--------------------------------------------------------------------------
    | SUCCESS RESPONSE
    |--------------------------------------------------------------------------
    */

    console.log(
      "LOGIN SUCCESS:",
      user.email
    );


    return res.status(200).json({
      success: true,

      accessToken,

      user: {
        id: user.id,
        full_name:
          user.full_name,
        email:
          user.email,
        role:
          user.role,
      },
    });


  } catch (e) {

    console.error(
      "======================================"
    );

    console.error(
      "LOGIN SERVER ERROR"
    );

    console.error(
      e
    );

    console.error(
      "======================================"
    );


    try {

      const {
        status,
        message,
      } = mapDbError(e);


      return res
        .status(status || 500)
        .json({
          success: false,
          message:
            message ||
            "Login failed",
        });

    } catch (mapError) {

      console.error(
        "mapDbError failed:",
        mapError
      );

      return res.status(500).json({
        success: false,
        message:
          "Login failed due to a server error",
      });
    }
  }
}


/*
|--------------------------------------------------------------------------
| REFRESH
|--------------------------------------------------------------------------
*/

export async function refresh(
  req,
  res
) {

  try {

    const token =
      req.cookies?.refreshToken;


    if (!token) {

      return res.status(401).json({
        success: false,
        message:
          "No refresh token",
      });
    }


    let decoded;

    try {

      decoded =
        verifyRefreshToken(
          token
        );

    } catch {

      return res.status(401).json({
        success: false,
        message:
          "Invalid refresh token",
      });
    }


    if (!decoded?.id) {

      return res.status(401).json({
        success: false,
        message:
          "Invalid refresh token",
      });
    }


    const tokenHash =
      hashToken(token);


    const [rows] =
      await pool.execute(
        `SELECT
          rt.user_id,
          u.email,
          u.full_name,
          u.role,
          u.is_approved,
          u.is_active
         FROM refresh_tokens rt
         JOIN users u
           ON u.id = rt.user_id
         WHERE rt.token_hash = ?
           AND rt.expires_at > NOW()
         LIMIT 1`,
        [tokenHash]
      );


    const row =
      rows[0];


    if (
      !row ||
      !row.is_active ||
      !row.is_approved
    ) {

      return res.status(401).json({
        success: false,
        message:
          "Session invalid",
      });
    }


    const payload = {
      id: row.user_id,
      email: row.email,
      role: row.role,
      full_name:
        row.full_name,
    };


    const accessToken =
      signAccessToken(
        payload
      );


    return res.status(200).json({
      success: true,
      accessToken,
      user: payload,
    });


  } catch (e) {

    console.error(
      "REFRESH ERROR:",
      e
    );


    const {
      status,
      message,
    } = mapDbError(e);


    return res
      .status(status || 500)
      .json({
        success: false,
        message:
          message ||
          "Refresh failed",
      });
  }
}


/*
|--------------------------------------------------------------------------
| LOGOUT
|--------------------------------------------------------------------------
*/

export async function logout(
  req,
  res
) {

  try {

    const token =
      req.cookies?.refreshToken;


    if (token) {

      try {

        const decoded =
          verifyRefreshToken(
            token
          );

        const tokenHash =
          hashToken(token);


        await pool.execute(
          `DELETE FROM refresh_tokens
           WHERE user_id = ?
             AND token_hash = ?`,
          [
            decoded.id,
            tokenHash,
          ]
        );

      } catch {
        // Ignore invalid/expired token
      }
    }


    res.clearCookie(
      "refreshToken",
      {
        httpOnly: true,
        secure:
          process.env.NODE_ENV ===
          "production",
        sameSite:
          process.env.NODE_ENV ===
          "production"
            ? "none"
            : "lax",
        path: "/api/auth",
      }
    );


    if (req.user?.id) {

      try {

        await auditLog(
          req.user.id,
          "LOGOUT",
          "users",
          req.user.id,
          null,
          clientIp(req)
        );

      } catch (auditError) {

        console.error(
          "Logout audit error:",
          auditError
        );
      }
    }


    return res.json({
      success: true,
      message:
        "Logged out",
    });


  } catch (e) {

    console.error(
      "LOGOUT ERROR:",
      e
    );


    const {
      status,
      message,
    } = mapDbError(e);


    return res
      .status(status || 500)
      .json({
        success: false,
        message:
          message ||
          "Logout failed",
      });
  }
}


/*
|--------------------------------------------------------------------------
| RESET PASSWORD
|--------------------------------------------------------------------------
*/

export async function resetPasswordWithCode(
  req,
  res
) {

  try {

    const {
      email,
      code,
      new_password,
      confirm_password,
    } = req.body || {};


    if (
      !email ||
      !code ||
      !new_password ||
      !confirm_password
    ) {

      return res.status(400).json({
        success: false,
        message:
          "All fields are required",
      });
    }


    if (
      new_password !==
      confirm_password
    ) {

      return res.status(400).json({
        success: false,
        message:
          "Passwords do not match",
      });
    }


    if (
      new_password.length < 8
    ) {

      return res.status(400).json({
        success: false,
        message:
          "Password must be at least 8 characters",
      });
    }


    const [users] =
      await pool.execute(
        `SELECT
          id,
          full_name,
          email
         FROM users
         WHERE email = ?
           AND is_active = TRUE`,
        [
          email
            .trim()
            .toLowerCase(),
        ]
      );


    const user =
      users[0];


    if (!user) {

      return res.status(400).json({
        success: false,
        message:
          "Invalid email or code",
      });
    }


    const codeHash =
      crypto
        .createHash("sha256")
        .update(
          code
            .trim()
            .toUpperCase()
        )
        .digest("hex");


    const [codes] =
      await pool.execute(
        `SELECT id
         FROM password_reset_codes
         WHERE user_id = ?
           AND code_hash = ?
           AND expires_at > NOW()
           AND used = 0
         LIMIT 1`,
        [
          user.id,
          codeHash,
        ]
      );


    if (!codes.length) {

      return res.status(400).json({
        success: false,
        message:
          "Invalid or expired code",
      });
    }


    const newHash =
      await bcrypt.hash(
        new_password,
        SALT
      );


    await pool.execute(
      `UPDATE password_reset_codes
       SET used = 1
       WHERE id = ?`,
      [codes[0].id]
    );


    await pool.execute(
      `UPDATE users
       SET password_hash = ?
       WHERE id = ?`,
      [
        newHash,
        user.id,
      ]
    );


    await pool.execute(
      `DELETE FROM refresh_tokens
       WHERE user_id = ?`,
      [user.id]
    );


    try {

      await auditLog(
        user.id,
        "PASSWORD_RESET",
        "users",
        user.id,
        {},
        clientIp(req)
      );

    } catch (auditError) {

      console.error(
        "Password reset audit error:",
        auditError
      );
    }


    sendPasswordChangedEmail({
      toEmail:
        user.email,
      fullName:
        user.full_name,
    }).catch(
      (err) =>
        console.error(
          "[mailer] Failed to send password-changed email:",
          err
        )
    );


    return res.json({
      success: true,
      message:
        "Password changed successfully. You can now log in.",
    });


  } catch (e) {

    console.error(
      "RESET PASSWORD ERROR:",
      e
    );


    const {
      status,
      message,
    } = mapDbError(e);


    return res
      .status(status || 500)
      .json({
        success: false,
        message:
          message ||
          "Password reset failed",
      });
  }
}


/*
|--------------------------------------------------------------------------
| CURRENT USER
|--------------------------------------------------------------------------
*/

export async function me(
  req,
  res
) {

  try {

    const [rows] =
      await pool.execute(
        `SELECT
          id,
          full_name,
          email,
          role,
          is_approved,
          is_active,
          created_at
         FROM users
         WHERE id = ?
         LIMIT 1`,
        [req.user.id]
      );


    const user =
      rows[0];


    if (!user) {

      return res.status(404).json({
        success: false,
        message:
          "User not found",
      });
    }


    return res.json({
      success: true,
      user,
    });


  } catch (e) {

    console.error(
      "ME ERROR:",
      e
    );


    const {
      status,
      message,
    } = mapDbError(e);


    return res
      .status(status || 500)
      .json({
        success: false,
        message:
          message ||
          "Unable to load user",
      });
  }
}
