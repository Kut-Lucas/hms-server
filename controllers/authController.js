// import bcrypt from "bcrypt";
// import crypto from "crypto";

// import { pool } from "../db/pool.js";
// import { auditLog } from "../utils/auditLog.js";
// import { mapDbError } from "../utils/dbErrors.js";

// import {
//   signAccessToken,
//   signRefreshToken,
//   verifyRefreshToken,
//   hashToken,
// } from "../utils/jwt.js";

// import { sendPasswordChangedEmail } from "../utils/mailer.js";

// const SALT = 10;

// /*
// |--------------------------------------------------------------------------
// | CLIENT IP
// |--------------------------------------------------------------------------
// */

// function clientIp(req) {
//   return (
//     req.headers["x-forwarded-for"]
//       ?.split(",")[0]
//       ?.trim() ||
//     req.socket?.remoteAddress ||
//     null
//   );
// }

// /*
// |--------------------------------------------------------------------------
// | REGISTER
// |--------------------------------------------------------------------------
// */

// export async function register(req, res) {
//   try {
//     const { full_name, email, password } = req.body || {};

//     if (!full_name || !email || !password) {
//       return res.status(400).json({
//         success: false,
//         message: "Missing required fields",
//       });
//     }

//     if (password.length < 8) {
//       return res.status(400).json({
//         success: false,
//         message: "Password must be at least 8 characters",
//       });
//     }

//     const cleanName = full_name.trim();
//     const cleanEmail = email.trim().toLowerCase();

//     const hash = await bcrypt.hash(password, SALT);

//     await pool.execute(
//       `INSERT INTO users
//         (
//           full_name,
//           email,
//           password_hash,
//           role,
//           is_approved,
//           is_active
//         )
//        VALUES
//         (?, ?, ?, 'receptionist', FALSE, TRUE)`,
//       [cleanName, cleanEmail, hash]
//     );

//     try {
//       await auditLog(
//         null,
//         "USER_REGISTER",
//         "users",
//         null,
//         { email: cleanEmail },
//         clientIp(req)
//       );
//     } catch (auditError) {
//       console.error(
//         "Registration audit log failed:",
//         auditError
//       );
//     }

//     return res.status(201).json({
//       success: true,
//       message:
//         "Registration successful. Pending admin approval before you can log in.",
//     });
//   } catch (e) {
//     console.error("REGISTER ERROR:", e);

//     if (e.code === "ER_DUP_ENTRY") {
//       return res.status(400).json({
//         success: false,
//         message: "Email already registered",
//       });
//     }

//     const { status, message } = mapDbError(e);

//     return res.status(status || 500).json({
//       success: false,
//       message: message || "Registration failed",
//     });
//   }
// }

// /*
// |--------------------------------------------------------------------------
// | LOGIN
// |--------------------------------------------------------------------------
// */

// export async function login(req, res) {
//   console.log("======================================");
//   console.log("LOGIN STARTED");
//   console.log("Origin:", req.headers.origin);
//   console.log("======================================");

//   try {
//     const { email, password } = req.body || {};

//     console.log("Email received:", email);

//     /*
//     |--------------------------------------------------------------------------
//     | Validate input
//     |--------------------------------------------------------------------------
//     */

//     if (!email || !password) {
//       console.log("LOGIN ERROR: Missing email or password");

//       return res.status(400).json({
//         success: false,
//         message: "Email and password required",
//       });
//     }

//     const cleanEmail = email.trim().toLowerCase();

//     /*
//     |--------------------------------------------------------------------------
//     | STEP 1 - Find user
//     |--------------------------------------------------------------------------
//     */

//     console.log("STEP 1: Searching for user...");

//     const [rows] = await pool.execute(
//       `SELECT
//         id,
//         full_name,
//         email,
//         password_hash,
//         role,
//         is_approved,
//         is_active
//        FROM users
//        WHERE email = ?
//        LIMIT 1`,
//       [cleanEmail]
//     );

//     console.log("STEP 1 COMPLETE");
//     console.log("User found:", rows.length > 0);

//     const user = rows[0];

//     if (!user) {
//       console.log("LOGIN FAILED: User not found");

//       try {
//         await auditLog(
//           null,
//           "LOGIN_FAILED",
//           "users",
//           null,
//           { email: cleanEmail },
//           clientIp(req)
//         );
//       } catch (auditError) {
//         console.error(
//           "Failed login audit error:",
//           auditError
//         );
//       }

//       return res.status(401).json({
//         success: false,
//         message: "Invalid credentials",
//       });
//     }

//     /*
//     |--------------------------------------------------------------------------
//     | STEP 2 - Check password
//     |--------------------------------------------------------------------------
//     */

//     console.log("STEP 2: Checking password...");

//     if (
//       !user.password_hash ||
//       typeof user.password_hash !== "string"
//     ) {
//       console.log(
//         "LOGIN FAILED: Invalid password hash"
//       );

//       return res.status(401).json({
//         success: false,
//         message: "Invalid credentials",
//       });
//     }

//     let passwordOk = false;

//     try {
//       passwordOk = await bcrypt.compare(
//         password,
//         user.password_hash
//       );
//     } catch (bcryptError) {
//       console.error(
//         "BCRYPT ERROR:",
//         bcryptError
//       );

//       passwordOk = false;
//     }

//     console.log("STEP 2 COMPLETE");
//     console.log("Password correct:", passwordOk);

//     if (!passwordOk) {
//       console.log("LOGIN FAILED: Invalid password");

//       try {
//         await auditLog(
//           null,
//           "LOGIN_FAILED",
//           "users",
//           null,
//           { email: cleanEmail },
//           clientIp(req)
//         );
//       } catch (auditError) {
//         console.error(
//           "Failed login audit error:",
//           auditError
//         );
//       }

//       return res.status(401).json({
//         success: false,
//         message: "Invalid credentials",
//       });
//     }

//     /*
//     |--------------------------------------------------------------------------
//     | STEP 3 - Account status
//     |--------------------------------------------------------------------------
//     */

//     console.log(
//       "STEP 3: Checking account status..."
//     );

//     if (!user.is_active) {
//       console.log(
//         "LOGIN FAILED: Account inactive"
//       );

//       return res.status(403).json({
//         success: false,
//         message: "Account deactivated",
//       });
//     }

//     if (!user.is_approved) {
//       console.log(
//         "LOGIN FAILED: Account pending approval"
//       );

//       return res.status(403).json({
//         success: false,
//         message:
//           "Account pending admin approval",
//       });
//     }

//     console.log("STEP 3 COMPLETE");
//     console.log(
//       "Account approved and active."
//     );

//     /*
//     |--------------------------------------------------------------------------
//     | STEP 4 - Create access token
//     |--------------------------------------------------------------------------
//     */

//     console.log(
//       "STEP 4: Creating access token..."
//     );

//     const payload = {
//       id: user.id,
//       email: user.email,
//       role: user.role,
//       full_name: user.full_name,
//     };

//     const accessToken =
//       signAccessToken(payload);

//     console.log("STEP 4 COMPLETE");

//     /*
//     |--------------------------------------------------------------------------
//     | STEP 5 - Create refresh token
//     |--------------------------------------------------------------------------
//     */

//     console.log(
//       "STEP 5: Creating refresh token..."
//     );

//     const refreshToken =
//       signRefreshToken({
//         id: user.id,
//         type: "refresh",
//       });

//     const tokenHash =
//       hashToken(refreshToken);

//     const decoded =
//       verifyRefreshToken(refreshToken);

//     const expiresAt = new Date(
//       decoded.exp * 1000
//     );

//     if (
//       Number.isNaN(
//         expiresAt.getTime()
//       )
//     ) {
//       throw new Error(
//         "Invalid refresh token expiry"
//       );
//     }

//     console.log("STEP 5 COMPLETE");

//     /*
//     |--------------------------------------------------------------------------
//     | STEP 6 - Save refresh token
//     |--------------------------------------------------------------------------
//     */

//     console.log(
//       "STEP 6: Deleting old refresh tokens..."
//     );

//     await pool.execute(
//       `DELETE FROM refresh_tokens
//        WHERE user_id = ?`,
//       [user.id]
//     );

//     console.log(
//       "STEP 6A COMPLETE"
//     );

//     console.log(
//       "STEP 6B: Saving new refresh token..."
//     );

//     await pool.execute(
//       `INSERT INTO refresh_tokens
//         (
//           user_id,
//           token_hash,
//           expires_at
//         )
//        VALUES
//         (?, ?, ?)`,
//       [
//         user.id,
//         tokenHash,
//         expiresAt,
//       ]
//     );

//     console.log(
//       "STEP 6 COMPLETE"
//     );

//     /*
//     |--------------------------------------------------------------------------
//     | STEP 7 - Set refresh cookie
//     |--------------------------------------------------------------------------
//     */

//     console.log(
//       "STEP 7: Setting refresh cookie..."
//     );

//     const production =
//       process.env.NODE_ENV ===
//       "production";

//     res.cookie(
//       "refreshToken",
//       refreshToken,
//       {
//         httpOnly: true,

//         secure: production,

//         sameSite: production
//           ? "none"
//           : "lax",

//         maxAge:
//           7 *
//           24 *
//           60 *
//           60 *
//           1000,

//         path: "/api/auth",
//       }
//     );

//     console.log(
//       "STEP 7 COMPLETE"
//     );

//     /*
//     |--------------------------------------------------------------------------
//     | STEP 8 - Audit login
//     |--------------------------------------------------------------------------
//     |
//     | Audit logging is intentionally protected.
//     | A failed audit log must NOT prevent login.
//     |--------------------------------------------------------------------------
//     */

//     console.log(
//       "STEP 8: Writing login audit..."
//     );

//     try {
//       await auditLog(
//         user.id,
//         "LOGIN_SUCCESS",
//         "users",
//         user.id,
//         null,
//         clientIp(req)
//       );

//       console.log(
//         "STEP 8 COMPLETE"
//       );
//     } catch (auditError) {
//       console.error(
//         "LOGIN AUDIT ERROR:",
//         auditError
//       );

//       console.log(
//         "Continuing login despite audit error."
//       );
//     }

//     /*
//     |--------------------------------------------------------------------------
//     | STEP 9 - Send response
//     |--------------------------------------------------------------------------
//     */

//     console.log(
//       "STEP 9: Sending login response..."
//     );

//     const responseUser = {
//       id: user.id,
//       full_name: user.full_name,
//       email: user.email,
//       role: user.role,
//     };

//     console.log(
//       "LOGIN SUCCESS:",
//       responseUser.email
//     );

//     console.log(
//       "======================================"
//     );

//     return res.status(200).json({
//       success: true,
//       accessToken,
//       user: responseUser,
//     });
//   } catch (error) {
//     console.error(
//       "======================================"
//     );

//     console.error(
//       "LOGIN SERVER ERROR"
//     );

//     console.error(error);

//     console.error(
//       "======================================"
//     );

//     try {
//       const {
//         status,
//         message,
//       } = mapDbError(error);

//       return res
//         .status(status || 500)
//         .json({
//           success: false,
//           message:
//             message ||
//             "Login failed due to a server error",
//         });
//     } catch (mapError) {
//       console.error(
//         "mapDbError failed:",
//         mapError
//       );

//       return res.status(500).json({
//         success: false,
//         message:
//           "Login failed due to a server error",
//       });
//     }
//   }
// }

// /*
// |--------------------------------------------------------------------------
// | REFRESH TOKEN
// |--------------------------------------------------------------------------
// */

// export async function refresh(req, res) {
//   try {
//     const token =
//       req.cookies?.refreshToken;

//     if (!token) {
//       return res.status(401).json({
//         success: false,
//         message: "No refresh token",
//       });
//     }

//     let decoded;

//     try {
//       decoded =
//         verifyRefreshToken(token);
//     } catch {
//       return res.status(401).json({
//         success: false,
//         message:
//           "Invalid refresh token",
//       });
//     }

//     if (!decoded?.id) {
//       return res.status(401).json({
//         success: false,
//         message:
//           "Invalid refresh token",
//       });
//     }

//     const tokenHash =
//       hashToken(token);

//     const [rows] =
//       await pool.execute(
//         `SELECT
//           rt.user_id,
//           u.email,
//           u.full_name,
//           u.role,
//           u.is_approved,
//           u.is_active
//          FROM refresh_tokens rt
//          JOIN users u
//            ON u.id = rt.user_id
//          WHERE rt.token_hash = ?
//            AND rt.expires_at > NOW()
//          LIMIT 1`,
//         [tokenHash]
//       );

//     const row = rows[0];

//     if (
//       !row ||
//       !row.is_active ||
//       !row.is_approved
//     ) {
//       return res.status(401).json({
//         success: false,
//         message: "Session invalid",
//       });
//     }

//     const payload = {
//       id: row.user_id,
//       email: row.email,
//       role: row.role,
//       full_name: row.full_name,
//     };

//     const accessToken =
//       signAccessToken(payload);

//     return res.status(200).json({
//       success: true,
//       accessToken,
//       user: payload,
//     });
//   } catch (e) {
//     console.error(
//       "REFRESH ERROR:",
//       e
//     );

//     const {
//       status,
//       message,
//     } = mapDbError(e);

//     return res
//       .status(status || 500)
//       .json({
//         success: false,
//         message:
//           message ||
//           "Refresh failed",
//       });
//   }
// }

// /*
// |--------------------------------------------------------------------------
// | LOGOUT
// |--------------------------------------------------------------------------
// */

// export async function logout(req, res) {
//   try {
//     const token =
//       req.cookies?.refreshToken;

//     if (token) {
//       try {
//         const decoded =
//           verifyRefreshToken(token);

//         const tokenHash =
//           hashToken(token);

//         await pool.execute(
//           `DELETE FROM refresh_tokens
//            WHERE user_id = ?
//              AND token_hash = ?`,
//           [
//             decoded.id,
//             tokenHash,
//           ]
//         );
//       } catch {
//         // Ignore invalid/expired token
//       }
//     }

//     const production =
//       process.env.NODE_ENV ===
//       "production";

//     res.clearCookie(
//       "refreshToken",
//       {
//         httpOnly: true,
//         secure: production,
//         sameSite: production
//           ? "none"
//           : "lax",
//         path: "/api/auth",
//       }
//     );

//     if (req.user?.id) {
//       try {
//         await auditLog(
//           req.user.id,
//           "LOGOUT",
//           "users",
//           req.user.id,
//           null,
//           clientIp(req)
//         );
//       } catch (auditError) {
//         console.error(
//           "Logout audit error:",
//           auditError
//         );
//       }
//     }

//     return res.json({
//       success: true,
//       message: "Logged out",
//     });
//   } catch (e) {
//     console.error(
//       "LOGOUT ERROR:",
//       e
//     );

//     const {
//       status,
//       message,
//     } = mapDbError(e);

//     return res
//       .status(status || 500)
//       .json({
//         success: false,
//         message:
//           message ||
//           "Logout failed",
//       });
//   }
// }

// /*
// |--------------------------------------------------------------------------
// | RESET PASSWORD
// |--------------------------------------------------------------------------
// */

// export async function resetPasswordWithCode(
//   req,
//   res
// ) {
//   try {
//     const {
//       email,
//       code,
//       new_password,
//       confirm_password,
//     } = req.body || {};

//     if (
//       !email ||
//       !code ||
//       !new_password ||
//       !confirm_password
//     ) {
//       return res.status(400).json({
//         success: false,
//         message:
//           "All fields are required",
//       });
//     }

//     if (
//       new_password !==
//       confirm_password
//     ) {
//       return res.status(400).json({
//         success: false,
//         message:
//           "Passwords do not match",
//       });
//     }

//     if (
//       new_password.length < 8
//     ) {
//       return res.status(400).json({
//         success: false,
//         message:
//           "Password must be at least 8 characters",
//       });
//     }

//     const cleanEmail =
//       email.trim().toLowerCase();

//     const [users] =
//       await pool.execute(
//         `SELECT
//           id,
//           full_name,
//           email
//          FROM users
//          WHERE email = ?
//            AND is_active = TRUE
//          LIMIT 1`,
//         [cleanEmail]
//       );

//     const user =
//       users[0];

//     if (!user) {
//       return res.status(400).json({
//         success: false,
//         message:
//           "Invalid email or code",
//       });
//     }

//     const codeHash =
//       crypto
//         .createHash("sha256")
//         .update(
//           code.trim().toUpperCase()
//         )
//         .digest("hex");

//     const [codes] =
//       await pool.execute(
//         `SELECT id
//          FROM password_reset_codes
//          WHERE user_id = ?
//            AND code_hash = ?
//            AND expires_at > NOW()
//            AND used = 0
//          LIMIT 1`,
//         [
//           user.id,
//           codeHash,
//         ]
//       );

//     if (!codes.length) {
//       return res.status(400).json({
//         success: false,
//         message:
//           "Invalid or expired code",
//       });
//     }

//     const newHash =
//       await bcrypt.hash(
//         new_password,
//         SALT
//       );

//     await pool.execute(
//       `UPDATE password_reset_codes
//        SET used = 1
//        WHERE id = ?`,
//       [codes[0].id]
//     );

//     await pool.execute(
//       `UPDATE users
//        SET password_hash = ?
//        WHERE id = ?`,
//       [
//         newHash,
//         user.id,
//       ]
//     );

//     await pool.execute(
//       `DELETE FROM refresh_tokens
//        WHERE user_id = ?`,
//       [user.id]
//     );

//     try {
//       await auditLog(
//         user.id,
//         "PASSWORD_RESET",
//         "users",
//         user.id,
//         {},
//         clientIp(req)
//       );
//     } catch (auditError) {
//       console.error(
//         "Password reset audit error:",
//         auditError
//       );
//     }

//     sendPasswordChangedEmail({
//       toEmail: user.email,
//       fullName: user.full_name,
//     }).catch((err) => {
//       console.error(
//         "[mailer] Failed to send password-changed email:",
//         err
//       );
//     });

//     return res.json({
//       success: true,
//       message:
//         "Password changed successfully. You can now log in.",
//     });
//   } catch (e) {
//     console.error(
//       "RESET PASSWORD ERROR:",
//       e
//     );

//     const {
//       status,
//       message,
//     } = mapDbError(e);

//     return res
//       .status(status || 500)
//       .json({
//         success: false,
//         message:
//           message ||
//           "Password reset failed",
//       });
//   }
// }

// /*
// |--------------------------------------------------------------------------
// | CURRENT USER
// |--------------------------------------------------------------------------
// */

// export async function me(req, res) {
//   try {
//     const [rows] =
//       await pool.execute(
//         `SELECT
//           id,
//           full_name,
//           email,
//           role,
//           is_approved,
//           is_active,
//           created_at
//          FROM users
//          WHERE id = ?
//          LIMIT 1`,
//         [req.user.id]
//       );

//     const user =
//       rows[0];

//     if (!user) {
//       return res.status(404).json({
//         success: false,
//         message:
//           "User not found",
//       });
//     }

//     return res.json({
//       success: true,
//       user,
//     });
//   } catch (e) {
//     console.error(
//       "ME ERROR:",
//       e
//     );

//     const {
//       status,
//       message,
//     } = mapDbError(e);

//     return res
//       .status(status || 500)
//       .json({
//         success: false,
//         message:
//           message ||
//           "Unable to load user",
//       });
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
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
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
    const { full_name, email, password } = req.body || {};

    if (!full_name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 8 characters",
      });
    }

    const cleanName = full_name.trim();
    const cleanEmail = email.trim().toLowerCase();

    const hash = await bcrypt.hash(password, SALT);

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
      [cleanName, cleanEmail, hash],
    );

    try {
      await auditLog(
        null,
        "USER_REGISTER",
        "users",
        null,
        { email: cleanEmail },
        clientIp(req),
      );
    } catch (auditError) {
      console.error("Registration audit log failed:", auditError);
    }

    return res.status(201).json({
      success: true,
      message:
        "Registration successful. Pending admin approval before you can log in.",
    });
  } catch (e) {
    console.error("REGISTER ERROR:", e);

    if (e.code === "ER_DUP_ENTRY") {
      return res.status(400).json({
        success: false,
        message: "Email already registered",
      });
    }

    const { status, message } = mapDbError(e);

    return res.status(status || 500).json({
      success: false,
      message: message || "Registration failed",
    });
  }
}

/*
|--------------------------------------------------------------------------
| LOGIN
|--------------------------------------------------------------------------
|
| IMPORTANT:
| - Does NOT use Promise.race() timeout.
| - Uses the existing indexed email column.
| - Uses pool.execute() exactly once.
| - Does not perform any other DB operation until the user is found.
|
*/

export async function login(req, res) {
  console.log("======================================");
  console.log("LOGIN STARTED");
  console.log("Origin:", req.headers.origin);
  console.log("======================================");

  try {
    const { email, password } = req.body || {};

    console.log("Email received:", email);

    /*
    |--------------------------------------------------------------------------
    | STEP 1 - Validate input
    |--------------------------------------------------------------------------
    */

    if (!email || !password) {
      console.log("LOGIN ERROR: Missing email or password");

      return res.status(400).json({
        success: false,
        message: "Email and password required",
      });
    }

    const cleanEmail = String(email).trim().toLowerCase();

    console.log("Clean email:", cleanEmail);

    /*
    |--------------------------------------------------------------------------
    | STEP 2 - Find user
    |--------------------------------------------------------------------------
    */

    console.log("STEP 1: Searching for user...");

    let rows;

    try {
      /*
       * email is UNIQUE:
       *
       * uq_users_email (email)
       *
       * Therefore MySQL should find this row extremely quickly.
       */

      const [result] = await pool.execute(
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
        [cleanEmail],
      );

      rows = result;

      console.log("STEP 1 COMPLETE");
      console.log("Rows returned:", rows.length);
    } catch (dbError) {
      console.error("======================================");
      console.error("LOGIN DATABASE ERROR");
      console.error("Code:", dbError?.code);
      console.error("Errno:", dbError?.errno);
      console.error("SQL State:", dbError?.sqlState);
      console.error("Message:", dbError?.message);
      console.error("======================================");

      return res.status(500).json({
        success: false,
        message: "Unable to connect to the database during login",
      });
    }

    const user = rows[0];

    /*
    |--------------------------------------------------------------------------
    | STEP 3 - User not found
    |--------------------------------------------------------------------------
    */

    if (!user) {
      console.log("LOGIN FAILED: User not found");

      try {
        await auditLog(
          null,
          "LOGIN_FAILED",
          "users",
          null,
          { email: cleanEmail },
          clientIp(req),
        );
      } catch (auditError) {
        console.error("Failed login audit error:", auditError);
      }

      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    console.log("User found:");
    console.log({
      id: user.id,
      email: user.email,
      role: user.role,
      is_approved: user.is_approved,
      is_active: user.is_active,
    });

    /*
    |--------------------------------------------------------------------------
    | STEP 4 - Check password
    |--------------------------------------------------------------------------
    */

    console.log("STEP 2: Checking password...");

    if (
      !user.password_hash ||
      typeof user.password_hash !== "string"
    ) {
      console.log("LOGIN FAILED: Invalid password hash");

      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    let passwordOk = false;

    try {
      passwordOk = await bcrypt.compare(
        password,
        user.password_hash,
      );
    } catch (bcryptError) {
      console.error("BCRYPT ERROR:", bcryptError);

      return res.status(500).json({
        success: false,
        message: "Password verification failed",
      });
    }

    console.log("STEP 2 COMPLETE");
    console.log("Password correct:", passwordOk);

    if (!passwordOk) {
      console.log("LOGIN FAILED: Invalid password");

      try {
        await auditLog(
          null,
          "LOGIN_FAILED",
          "users",
          null,
          { email: cleanEmail },
          clientIp(req),
        );
      } catch (auditError) {
        console.error("Failed login audit error:", auditError);
      }

      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | STEP 5 - Account status
    |--------------------------------------------------------------------------
    */

    console.log("STEP 3: Checking account status...");

    if (!user.is_active) {
      console.log("LOGIN FAILED: Account inactive");

      return res.status(403).json({
        success: false,
        message: "Account deactivated",
      });
    }

    if (!user.is_approved) {
      console.log("LOGIN FAILED: Account pending approval");

      return res.status(403).json({
        success: false,
        message: "Account pending admin approval",
      });
    }

    console.log("STEP 3 COMPLETE");
    console.log("Account approved and active.");

    /*
    |--------------------------------------------------------------------------
    | STEP 6 - Create access token
    |--------------------------------------------------------------------------
    */

    console.log("STEP 4: Creating access token...");

    const payload = {
      id: user.id,
      email: user.email,
      role: user.role,
      full_name: user.full_name,
    };

    const accessToken = signAccessToken(payload);

    console.log("STEP 4 COMPLETE");

    /*
    |--------------------------------------------------------------------------
    | STEP 7 - Create refresh token
    |--------------------------------------------------------------------------
    */

    console.log("STEP 5: Creating refresh token...");

    const refreshToken = signRefreshToken({
      id: user.id,
      type: "refresh",
    });

    const tokenHash = hashToken(refreshToken);

    const decoded = verifyRefreshToken(refreshToken);

    if (!decoded?.exp) {
      throw new Error("Invalid refresh token expiry");
    }

    const expiresAt = new Date(decoded.exp * 1000);

    if (Number.isNaN(expiresAt.getTime())) {
      throw new Error("Invalid refresh token expiry");
    }

    console.log("STEP 5 COMPLETE");

    /*
    |--------------------------------------------------------------------------
    | STEP 8 - Save refresh token
    |--------------------------------------------------------------------------
    */

    console.log("STEP 6: Deleting old refresh tokens...");

    try {
      await pool.execute(
        `DELETE FROM refresh_tokens
         WHERE user_id = ?`,
        [user.id],
      );

      console.log("STEP 6A COMPLETE");

      console.log("STEP 6B: Saving new refresh token...");

      await pool.execute(
        `INSERT INTO refresh_tokens
          (
            user_id,
            token_hash,
            expires_at
          )
         VALUES
          (?, ?, ?)`,
        [user.id, tokenHash, expiresAt],
      );

      console.log("STEP 6 COMPLETE");
    } catch (tokenDbError) {
      console.error("REFRESH TOKEN DATABASE ERROR:", tokenDbError);

      /*
       * Do not expose database internals to the client.
       */
      return res.status(500).json({
        success: false,
        message: "Unable to create login session",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | STEP 9 - Set refresh cookie
    |--------------------------------------------------------------------------
    */

    console.log("STEP 7: Setting refresh cookie...");

    const production = process.env.NODE_ENV === "production";

    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: production,
      sameSite: production ? "none" : "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: "/api/auth",
    });

    console.log("STEP 7 COMPLETE");

    /*
    |--------------------------------------------------------------------------
    | STEP 10 - Audit login
    |--------------------------------------------------------------------------
    */

    console.log("STEP 8: Writing login audit...");

    try {
      await auditLog(
        user.id,
        "LOGIN_SUCCESS",
        "users",
        user.id,
        null,
        clientIp(req),
      );

      console.log("STEP 8 COMPLETE");
    } catch (auditError) {
      console.error("LOGIN AUDIT ERROR:", auditError);
      console.log("Continuing login despite audit error.");
    }

    /*
    |--------------------------------------------------------------------------
    | STEP 11 - Send response
    |--------------------------------------------------------------------------
    */

    console.log("STEP 9: Sending login response...");

    const responseUser = {
      id: user.id,
      full_name: user.full_name,
      email: user.email,
      role: user.role,
    };

    console.log("LOGIN SUCCESS:", responseUser.email);
    console.log("======================================");

    return res.status(200).json({
      success: true,
      accessToken,
      user: responseUser,
    });
  } catch (error) {
    console.error("======================================");
    console.error("LOGIN SERVER ERROR");
    console.error(error);
    console.error("======================================");

    try {
      const { status, message } = mapDbError(error);

      return res.status(status || 500).json({
        success: false,
        message:
          message || "Login failed due to a server error",
      });
    } catch (mapError) {
      console.error("mapDbError failed:", mapError);

      return res.status(500).json({
        success: false,
        message: "Login failed due to a server error",
      });
    }
  }
}

/*
|--------------------------------------------------------------------------
| REFRESH TOKEN
|--------------------------------------------------------------------------
*/

export async function refresh(req, res) {
  try {
    const token = req.cookies?.refreshToken;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "No refresh token",
      });
    }

    let decoded;

    try {
      decoded = verifyRefreshToken(token);
    } catch {
      return res.status(401).json({
        success: false,
        message: "Invalid refresh token",
      });
    }

    if (!decoded?.id) {
      return res.status(401).json({
        success: false,
        message: "Invalid refresh token",
      });
    }

    const tokenHash = hashToken(token);

    const [rows] = await pool.execute(
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
      [tokenHash],
    );

    const row = rows[0];

    if (!row || !row.is_active || !row.is_approved) {
      return res.status(401).json({
        success: false,
        message: "Session invalid",
      });
    }

    const payload = {
      id: row.user_id,
      email: row.email,
      role: row.role,
      full_name: row.full_name,
    };

    const accessToken = signAccessToken(payload);

    return res.status(200).json({
      success: true,
      accessToken,
      user: payload,
    });
  } catch (e) {
    console.error("REFRESH ERROR:", e);

    const { status, message } = mapDbError(e);

    return res.status(status || 500).json({
      success: false,
      message: message || "Refresh failed",
    });
  }
}

/*
|--------------------------------------------------------------------------
| LOGOUT
|--------------------------------------------------------------------------
*/

export async function logout(req, res) {
  try {
    const token = req.cookies?.refreshToken;

    if (token) {
      try {
        const decoded = verifyRefreshToken(token);
        const tokenHash = hashToken(token);

        await pool.execute(
          `DELETE FROM refresh_tokens
           WHERE user_id = ?
             AND token_hash = ?`,
          [decoded.id, tokenHash],
        );
      } catch {
        // Ignore invalid/expired token
      }
    }

    const production = process.env.NODE_ENV === "production";

    res.clearCookie("refreshToken", {
      httpOnly: true,
      secure: production,
      sameSite: production ? "none" : "lax",
      path: "/api/auth",
    });

    if (req.user?.id) {
      try {
        await auditLog(
          req.user.id,
          "LOGOUT",
          "users",
          req.user.id,
          null,
          clientIp(req),
        );
      } catch (auditError) {
        console.error("Logout audit error:", auditError);
      }
    }

    return res.json({
      success: true,
      message: "Logged out",
    });
  } catch (e) {
    console.error("LOGOUT ERROR:", e);

    const { status, message } = mapDbError(e);

    return res.status(status || 500).json({
      success: false,
      message: message || "Logout failed",
    });
  }
}

/*
|--------------------------------------------------------------------------
| RESET PASSWORD
|--------------------------------------------------------------------------
*/

export async function resetPasswordWithCode(req, res) {
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
        message: "All fields are required",
      });
    }

    if (new_password !== confirm_password) {
      return res.status(400).json({
        success: false,
        message: "Passwords do not match",
      });
    }

    if (new_password.length < 8) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 8 characters",
      });
    }

    const cleanEmail = email.trim().toLowerCase();

    const [users] = await pool.execute(
      `SELECT
          id,
          full_name,
          email
         FROM users
         WHERE email = ?
           AND is_active = TRUE
         LIMIT 1`,
      [cleanEmail],
    );

    const user = users[0];

    if (!user) {
      return res.status(400).json({
        success: false,
        message: "Invalid email or code",
      });
    }

    const codeHash = crypto
      .createHash("sha256")
      .update(code.trim().toUpperCase())
      .digest("hex");

    const [codes] = await pool.execute(
      `SELECT id
         FROM password_reset_codes
         WHERE user_id = ?
           AND code_hash = ?
           AND expires_at > NOW()
           AND used = 0
         LIMIT 1`,
      [user.id, codeHash],
    );

    if (!codes.length) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired code",
      });
    }

    const newHash = await bcrypt.hash(
      new_password,
      SALT,
    );

    await pool.execute(
      `UPDATE password_reset_codes
       SET used = 1
       WHERE id = ?`,
      [codes[0].id],
    );

    await pool.execute(
      `UPDATE users
       SET password_hash = ?
       WHERE id = ?`,
      [newHash, user.id],
    );

    await pool.execute(
      `DELETE FROM refresh_tokens
       WHERE user_id = ?`,
      [user.id],
    );

    try {
      await auditLog(
        user.id,
        "PASSWORD_RESET",
        "users",
        user.id,
        {},
        clientIp(req),
      );
    } catch (auditError) {
      console.error(
        "Password reset audit error:",
        auditError,
      );
    }

    sendPasswordChangedEmail({
      toEmail: user.email,
      fullName: user.full_name,
    }).catch((err) => {
      console.error(
        "[mailer] Failed to send password-changed email:",
        err,
      );
    });

    return res.json({
      success: true,
      message:
        "Password changed successfully. You can now log in.",
    });
  } catch (e) {
    console.error("RESET PASSWORD ERROR:", e);

    const { status, message } = mapDbError(e);

    return res.status(status || 500).json({
      success: false,
      message: message || "Password reset failed",
    });
  }
}

/*
|--------------------------------------------------------------------------
| CURRENT USER
|--------------------------------------------------------------------------
*/

export async function me(req, res) {
  try {
    const [rows] = await pool.execute(
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
      [req.user.id],
    );

    const user = rows[0];

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    return res.json({
      success: true,
      user,
    });
  } catch (e) {
    console.error("ME ERROR:", e);

    const { status, message } = mapDbError(e);

    return res.status(status || 500).json({
      success: false,
      message: message || "Unable to load user",
    });
  }
}
