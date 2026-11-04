-- CherryLink MySQL 8.0+ schema. Import into a NEW empty UTF8MB4 database.
-- mysql --default-character-set=utf8mb4 -u USER -p cherrylink < mysql/migrations/0001_initial.sql
-- Always use InnoDB; timestamps are UTC (database session time_zone='+00:00').
CREATE TABLE users (
 id CHAR(36) PRIMARY KEY, email VARCHAR(254) NOT NULL UNIQUE, password_hash VARCHAR(255) NOT NULL,
 display_name VARCHAR(120), disabled BOOLEAN NOT NULL DEFAULT FALSE,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;
CREATE TABLE sessions (
 token_hash CHAR(64) PRIMARY KEY, user_id CHAR(36) NOT NULL,
 expires_at DATETIME(3) NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 INDEX sessions_user_idx(user_id),INDEX sessions_expiry_idx(expires_at),
 FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE workspaces (
 id CHAR(36) PRIMARY KEY,name VARCHAR(120) NOT NULL,timezone VARCHAR(80) NOT NULL DEFAULT 'Asia/Kolkata',
 settings JSON NOT NULL,created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;
CREATE TABLE workspace_members (
 id CHAR(36) PRIMARY KEY,workspace_id CHAR(36) NOT NULL,user_id CHAR(36) NOT NULL,
 role ENUM('ADMIN','EDITOR') NOT NULL DEFAULT 'EDITOR',
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 UNIQUE KEY uq_workspace_user(workspace_id,user_id), INDEX workspace_members_user_idx(user_id),
 FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
 FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE workspace_invitations(
 token_hash CHAR(64) PRIMARY KEY,workspace_id CHAR(36) NOT NULL,invited_by CHAR(36) NOT NULL,
 email VARCHAR(254) NOT NULL,role ENUM('ADMIN','EDITOR') NOT NULL,
 expires_at DATETIME(3) NOT NULL,accepted_at DATETIME(3) NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 INDEX invite_email_idx(email),INDEX invite_expiry_idx(expires_at),
 FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
 FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE social_accounts(
 id CHAR(36) PRIMARY KEY,workspace_id CHAR(36) NOT NULL,
 platform ENUM('FACEBOOK','INSTAGRAM') NOT NULL,
 provider_account_id VARCHAR(120) NOT NULL,name VARCHAR(240) NOT NULL,
 username VARCHAR(240),account_type VARCHAR(80),
 connection_status ENUM('CONNECTED','RECONNECT_REQUIRED','DISCONNECTED') NOT NULL DEFAULT 'CONNECTED',
 token_reference CHAR(36) NULL,permission_metadata JSON NOT NULL,token_expiry DATETIME(3) NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 UNIQUE KEY uq_social_provider(workspace_id,platform,provider_account_id),
 UNIQUE KEY uq_social_id_workspace(id,workspace_id),
 UNIQUE KEY uq_social_id_platform(id,platform),
 INDEX social_workspace_idx(workspace_id,platform),
 FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE social_account_credentials(
 id CHAR(36) PRIMARY KEY,social_account_id CHAR(36) NOT NULL UNIQUE,
 encrypted_token TEXT NOT NULL,token_kind VARCHAR(80) NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 rotated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 FOREIGN KEY (social_account_id) REFERENCES social_accounts(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE oauth_states (
 state_hash CHAR(64) PRIMARY KEY,workspace_id CHAR(36) NOT NULL,actor_id CHAR(36) NOT NULL,
 platform ENUM('FACEBOOK','INSTAGRAM') NOT NULL,
 expires_at DATETIME(3) NOT NULL,consumed_at DATETIME(3) NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 INDEX oauth_expiry_idx(expires_at),
 FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
 FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE connection_sessions(
 id CHAR(36) PRIMARY KEY,workspace_id CHAR(36) NOT NULL,actor_id CHAR(36) NOT NULL,
 platform ENUM('FACEBOOK','INSTAGRAM') NOT NULL,encrypted_token TEXT NOT NULL,
 token_kind VARCHAR(100) NOT NULL,permission_metadata JSON NOT NULL,
 expires_at DATETIME(3) NOT NULL,consumed_at DATETIME(3) NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 INDEX connection_sessions_expiry_idx(expires_at),
 FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
 FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE media_assets(
 id CHAR(36) PRIMARY KEY,workspace_id CHAR(36) NOT NULL,storage_path VARCHAR(512) NOT NULL UNIQUE,
 original_filename VARCHAR(240) NOT NULL,mime_type VARCHAR(100) NOT NULL,
 size_bytes BIGINT UNSIGNED NOT NULL,width INT,height INT,duration_seconds DECIMAL(10,2),
 checksum_sha256 CHAR(64) NOT NULL,processing_status VARCHAR(32) NOT NULL DEFAULT 'READY',
 metadata JSON NOT NULL,created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 UNIQUE KEY uq_media_id_workspace(id,workspace_id),
 INDEX media_workspace_idx(workspace_id,created_at),
 FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
 CHECK(size_bytes>0)
) ENGINE=InnoDB;
CREATE TABLE posts(
 id CHAR(36) PRIMARY KEY,workspace_id CHAR(36) NOT NULL,created_by CHAR(36) NOT NULL,
 media_asset_id CHAR(36),caption TEXT NOT NULL,scheduled_at_utc DATETIME(3),
 timezone VARCHAR(80) NOT NULL DEFAULT 'Asia/Kolkata',
 lifecycle_status VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
 content_origin VARCHAR(32) NOT NULL DEFAULT 'HUMAN_UPLOAD',
 approval_status VARCHAR(32) NOT NULL DEFAULT 'NOT_REQUIRED',
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 UNIQUE KEY uq_posts_id_workspace(id,workspace_id),
 INDEX posts_schedule_idx(workspace_id,scheduled_at_utc),
 FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
 FOREIGN KEY (created_by) REFERENCES users(id),
 FOREIGN KEY (media_asset_id,workspace_id) REFERENCES media_assets(id,workspace_id)
) ENGINE=InnoDB;
CREATE TABLE post_targets(
 id CHAR(36) PRIMARY KEY,post_id CHAR(36) NOT NULL,workspace_id CHAR(36) NOT NULL,
 social_account_id CHAR(36) NOT NULL,platform ENUM('FACEBOOK','INSTAGRAM') NOT NULL,
 content_type ENUM('TEXT','IMAGE','REEL') NOT NULL,caption_override TEXT,
 scheduled_at_utc DATETIME(3) NOT NULL,
 publishing_status ENUM('DRAFT','SCHEDULED','PREPARING','READY','PUBLISHING','PUBLISHED','RETRY_WAIT','FAILED','ACTION_REQUIRED','UNKNOWN','CANCELLED') NOT NULL DEFAULT 'SCHEDULED',
 provider_container_id VARCHAR(180),provider_post_id VARCHAR(180),provider_permalink VARCHAR(1500),published_at DATETIME(3),
 last_error_code VARCHAR(128),last_error_message VARCHAR(1000),
 request_stage VARCHAR(100) NOT NULL DEFAULT 'NOT_STARTED',
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 UNIQUE KEY uq_post_account(post_id,social_account_id),
 INDEX target_due_idx(scheduled_at_utc,publishing_status),
 INDEX target_account_idx(social_account_id,publishing_status),
 FOREIGN KEY (post_id,workspace_id) REFERENCES posts(id,workspace_id) ON DELETE CASCADE,
 FOREIGN KEY (social_account_id,workspace_id) REFERENCES social_accounts(id,workspace_id),
 FOREIGN KEY (social_account_id,platform) REFERENCES social_accounts(id,platform)
) ENGINE=InnoDB;
CREATE TABLE publication_jobs (
 id CHAR(36) PRIMARY KEY,post_target_id CHAR(36) NOT NULL UNIQUE,
 status ENUM('QUEUED','RUNNING','DONE','CANCELLED','UNKNOWN') NOT NULL DEFAULT 'QUEUED',
 available_at DATETIME(3) NOT NULL,locked_until DATETIME(3),worker_id VARCHAR(140),
 attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 INDEX jobs_due_idx(status,available_at,id),
 INDEX jobs_lease_idx(status,locked_until),
 FOREIGN KEY (post_target_id) REFERENCES post_targets(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE account_publish_leases (
 social_account_id CHAR(36) PRIMARY KEY,worker_id VARCHAR(140) NOT NULL,
 leased_until DATETIME(3) NOT NULL,
 FOREIGN KEY (social_account_id) REFERENCES social_accounts(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE publication_attempts (
 id CHAR(36) PRIMARY KEY,post_target_id CHAR(36) NOT NULL,
 attempt_number INT UNSIGNED NOT NULL,started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 finished_at DATETIME(3),provider_operation VARCHAR(120),provider_request_reference VARCHAR(160),
 safe_error_code VARCHAR(128),outcome VARCHAR(32) NOT NULL DEFAULT 'STARTED',
 UNIQUE KEY uq_target_attempt(post_target_id,attempt_number),
 INDEX attempts_history_idx(post_target_id,started_at),
 FOREIGN KEY (post_target_id) REFERENCES post_targets(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE publication_events (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,post_target_id CHAR(36) NOT NULL,
 old_status VARCHAR(32),new_status VARCHAR(32) NOT NULL,reason VARCHAR(128),
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 INDEX event_target_idx(post_target_id,created_at),
 FOREIGN KEY (post_target_id) REFERENCES post_targets(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE audit_logs (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,workspace_id CHAR(36) NOT NULL,
 actor_id CHAR(36),entity_type VARCHAR(100) NOT NULL,entity_id VARCHAR(150) NOT NULL,
 action VARCHAR(120) NOT NULL,created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 metadata JSON NOT NULL,INDEX audit_workspace_idx(workspace_id,created_at),
 FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE worker_heartbeats (
 worker_id VARCHAR(140) PRIMARY KEY,last_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',details JSON
) ENGINE=InnoDB;
DELIMITER $$
CREATE TRIGGER trg_target_prevent_republish BEFORE UPDATE ON post_targets FOR EACH ROW
BEGIN
 IF OLD.publishing_status='PUBLISHED' AND NEW.publishing_status<>'PUBLISHED' THEN
   SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Published target cannot return to unpublished state';
 END IF;
END$$
CREATE TRIGGER trg_target_status_insert AFTER INSERT ON post_targets FOR EACH ROW
BEGIN
 INSERT INTO publication_events(post_target_id,old_status,new_status,reason)
 VALUES(NEW.id,NULL,NEW.publishing_status,NEW.last_error_code);
END$$
CREATE TRIGGER trg_target_status_update AFTER UPDATE ON post_targets FOR EACH ROW
BEGIN
 IF OLD.publishing_status<>NEW.publishing_status THEN
   INSERT INTO publication_events(post_target_id,old_status,new_status,reason)
   VALUES(NEW.id,OLD.publishing_status,NEW.publishing_status,NEW.last_error_code);
 END IF;
END$$
DELIMITER ;
