CREATE TABLE auth.users (
    id             UUID         PRIMARY KEY,
    email          VARCHAR(200) NOT NULL UNIQUE,
    name           VARCHAR(200) NOT NULL,
    password_hash  VARCHAR(100) NOT NULL,          -- BCrypt, never the password itself
    role           VARCHAR(10)  NOT NULL CHECK (role IN ('USER', 'ADMIN')),
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);
