# Project Context

## プロジェクト概要
プロジェクト名: Salesforce CRM
エディション: Enterprise
主な用途: 営業支援・顧客管理

## 主要オブジェクト
| オブジェクト | 用途 | 特記事項 |
|---|---|---|
| Account | 顧客企業 | 階層構造あり（ParentId） |
| Contact | 担当者 | Account に従属 |
| Opportunity | 商談 | Stage・CloseDate が必須 |

## アーキテクチャ制約
- レイヤー構成: Trigger -> Handler -> Service -> Selector（fflib 準拠）
- 非同期処理: Queueable 優先（Batch は大量データ専用）
- 外部連携: Named Credentials 必須。Callout は Queueable 内のみ

## コーディング規約
詳細は `context/coding-conventions.md` を参照。

## セキュリティ要件
- 全 Apex クラスは `with sharing` を原則とする
- `without sharing` を使用する場合はクラス先頭にコメントで理由を記載する
- DML 前の CRUD/FLS チェックは必須

## 禁止事項
- SOQL in loop
- DML in loop
- `SeeAllData=true` のテストクラス
- ハードコードされた Id 値
