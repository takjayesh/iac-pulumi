# Infrastructure as Code with Pulumi 🚀

This document serves as a comprehensive guide for leveraging Pulumi to construct network infrastructure, focusing on the creation of a Virtual Private Cloud (VPC), including public and private subnets, route tables, and an Internet Gateway for public internet access.

## Prerequisites 📋

Before diving into the setup, ensure the following tools are installed and configured:

- **Pulumi CLI** 🛠: For orchestrating infrastructure as code.
- **AWS CLI** 🛠: Configured with the necessary credentials for AWS resource management.

## Infrastructure Setup Steps 🏗

### 1. **Initialize a Pulumi Project**
   Kick off your infrastructure project with Pulumi.
   ```bash
   pulumi new aws-javascript
2. Configure Your Project
Tailor your Pulumi.dev.yaml for specific VPC and subnet configurations.

3. Deploy Infrastructure
Use Pulumi in your JavaScript (e.g., index.js) to define and roll out your infrastructure.

AWS Resource Setup 🌐
Virtual Private Cloud (VPC) 🌍
Setup: Instantiate a VPC named "myVPC" with a predefined CIDR block.

Internet Gateway 🛣
Implementation: Deploy an Internet Gateway "myInternetGateway" and attach it to the VPC.

Availability Zones 📍
Selection: Fetch and utilize the first three availability zones.

Subnets 🏘
Configuration: Establish public and private subnets across availability zones, linking them to route tables.

Route Tables 🗺
Creation: Set up public and private route tables and associate them with the respective subnets.

Security Groups 🔒
Establishment: Formulate security groups for a load balancer, EC2 instances, and an RDS instance.

Relational Database Service (RDS) 💾
Deployment: Launch a MySQL RDS instance with specified configurations.

Identity and Access Management (IAM) 👤
Role Creation: Craft an IAM role with EC2 policies and attach additional policies for CloudWatch and S3.

Load Balancer ⚖️
Setup: Erect an Application Load Balancer with detailed configurations, listeners, and target groups.

Auto Scaling 📈
Implementation: Configure an Auto Scaling Group with specific policies and CloudWatch alarms for scaling.

AWS Lambda 🔄
Functionality: Establish an IAM role for Lambda, then define and implement a Lambda function with S3 dependencies.

Simple Notification Service (SNS) 📢
Notifications: Create an SNS topic and subscription tailored for the Lambda function.

CloudWatch Alarms ⏰
Monitoring: Set up alarms for auto-scaling based on CPU utilization metrics.

Route53 🌐
DNS Setup: Create a Route53 record to direct traffic to the load balancer.

DynamoDB 🗃
Database Creation: Erect a DynamoDB table with specific attributes and indexes, attaching an IAM policy for access.

S3 Bucket 🪣
Storage Setup: Initiate an S3 bucket "pranav-bucket-1" with private access settings.

Google Cloud Platform (GCP) Resources ☁️
Cloud Storage (GCS) 🗂
Bucket Creation: Formulate a GCS bucket "csye6225_demo_gcs_bucket" with versioning enabled.

GCP IAM 🔑
Service Account Setup: Create a service account with requisite permissions for the GCS bucket.

GCP IAM Policy 📜
Policy Application: Attach a custom IAM policy to the Lambda execution role for GCS access.

Outputs 📤
Conclude by exporting IDs and pertinent details of the created resources for integration and reference purposes.
