-- MySQL dump 10.13  Distrib 8.0.34, for Linux (x86_64)
--
-- Host: localhost    Database: shop
-- ------------------------------------------------------
/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET NAMES utf8mb4 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;

--
-- Table structure for table `customers`
--

DROP TABLE IF EXISTS `customers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `customers` (
  `id` int NOT NULL AUTO_INCREMENT,
  `email` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(100) CHARACTER SET utf8mb4 DEFAULT NULL,
  `credit` decimal(10,2) unsigned NOT NULL DEFAULT '0.00',
  `status` enum('active','blocked','pending') NOT NULL DEFAULT 'pending',
  `created` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `flags` tinyint(1) NOT NULL DEFAULT '0',
  `bio` longtext COMMENT 'free text; with semicolon, and (parens)',
  `big` bigint unsigned DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_email` (`email`),
  KEY `idx_name_status` (`name`,`status`),
  FULLTEXT KEY `ft_bio` (`bio`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `customers`
--

LOCK TABLES `customers` WRITE;
/*!40000 ALTER TABLE `customers` DISABLE KEYS */;
INSERT INTO `customers` VALUES (1,'a@x.com','Al; ice',0.00,'active','2020-01-01 00:00:00','2020-01-01 00:00:00',0,'CREATE TABLE `bad` (id int); -- hi',NULL),(2,'b@x.com','O\'Brien',1.00,'pending',NULL,'2020-01-01 00:00:00',1,'x /* y */ z',5);
/*!40000 ALTER TABLE `customers` ENABLE KEYS */;
UNLOCK TABLES;

DROP TABLE IF EXISTS `orders`;
CREATE TABLE `orders` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `customer_id` int NOT NULL,
  `parent_id` bigint DEFAULT NULL,
  `total` decimal(12,2) NOT NULL,
  `placed` date DEFAULT NULL,
  `ref_code` char(8) NOT NULL,
  `payload` json DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_ref` (`ref_code`),
  KEY `fk_orders_customer` (`customer_id`),
  KEY `fk_orders_parent` (`parent_id`),
  CONSTRAINT `fk_orders_customer` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT `fk_orders_parent` FOREIGN KEY (`parent_id`) REFERENCES `orders` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

DROP TABLE IF EXISTS `order_lines`;
CREATE TABLE `order_lines` (
  `order_id` bigint NOT NULL,
  `line` int NOT NULL,
  `sku` varchar(32) NOT NULL,
  `qty` int NOT NULL DEFAULT '1',
  PRIMARY KEY (`order_id`,`line`),
  UNIQUE KEY `uk_order_sku` (`order_id`,`sku`),
  KEY `idx_sku` (`sku`(10)),
  CONSTRAINT `fk_lines_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `tags` (
  `id` int NOT NULL AUTO_INCREMENT,
  `label` varchar(50) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;

CREATE TABLE `customer_tags` (
  `customer_id` int NOT NULL,
  `tag_id` int NOT NULL,
  PRIMARY KEY (`customer_id`,`tag_id`),
  CONSTRAINT `fk_ct_c` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`),
  CONSTRAINT `fk_ct_t` FOREIGN KEY (`tag_id`) REFERENCES `tags` (`id`)
) ENGINE=InnoDB;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
-- Dump completed on 2024-01-01  0:00:00
