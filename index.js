const pulumi = require("@pulumi/pulumi");
const aws = require("@pulumi/aws");
const gcp = require("@pulumi/gcp");
const fs = require('fs');
const SubnetCIDRAdviser = require("subnet-cidr-calculator");

const config = new pulumi.Config();
const cidrBlock = config.require("cidrBlock");
const vpcName = config.require("vpcName");
const publicSSHkey = config.require("publicSSHkey"); // Public SSH key to be added to the EC2 instance
const publicSubnetCidr = config.require("publicSubnetCidr");
const existingSubnetCIDR = config.require("existingSubnetCIDR");
const addressDotQuad = config.require("addressDotQuad");
const netmaskBits = config.require("netmaskBits");
const customAmiId = "ami-0d47dcbc024b0af3b";
const applicationPort = config.require("applicationPort");
const dbName = config.require("dbName");
const username = config.require("username");
const password = config.require("password");
//const lambdaRolePolicyarn = config.require("lamdaRolePolicyConfig");
const lambdaRolePolicyarn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"


const regione = "us-east-1"


const privateSubnets = [];
const publicSubnets = [];
const dialect = 'mysql'

console.log(cidrBlock);

function userTags(tag) {
  return {
    Name: vpcName + "-" + tag,
  };
}

async function createServices() {
  const vpc = new aws.ec2.Vpc("vpc", {
    cidrBlock: cidrBlock,
    tags: userTags("vpc"),
  });

  const publicRouteTable = new aws.ec2.RouteTable("publicRouteTable", {
    vpcId: vpc.id,
    tags: userTags("public-route-table"),
  });

  const privateRouteTable = new aws.ec2.RouteTable("privateRouteTable", {
    vpcId: vpc.id,
    tags: userTags("private-route-table"),
  });

  const internetGateway = new aws.ec2.InternetGateway("internetGateway", {
    vpcId: vpc.id,
    tags: userTags("internet-gateway"),
  });

  const publicInternetGatewayRoute = new aws.ec2.Route("publicInternetGatewayRoute", {
    routeTableId: publicRouteTable.id,
    destinationCidrBlock: publicSubnetCidr,
    gatewayId: internetGateway.id,
  });

  const availabilityZones = await aws.getAvailabilityZones({
    state: "available",
  });
  console.log(`Availability Zones: ${JSON.stringify(availabilityZones.names)}`);

  const totalAvailabilityZones = availabilityZones.names.length;
  console.log(`Total Availability Zones: ${totalAvailabilityZones}`);


  //Creating Subnets
  let count = 0;
  if (totalAvailabilityZones >= 3) {
    count = 3;
  } else if (totalAvailabilityZones < 3) {
    count = totalAvailabilityZones;
  }

  const probabal_subnets = SubnetCIDRAdviser.calculate(
    addressDotQuad,
    netmaskBits,
    [existingSubnetCIDR]
  );
  console.log("probabal_subnets: ", probabal_subnets);
  const firstInitialSubnets = probabal_subnets.subnets.slice(0, count * 2);
  console.log("firstInitialSubnets: ", firstInitialSubnets);

  const cidrToValidate = "";
  const getNextValidCIDR = SubnetCIDRAdviser.getNextValidCIDR(
    cidrBlock,
    [existingSubnetCIDR],
    probabal_subnets,
    cidrToValidate
  );
  console.log("getNextValidCIDR is", getNextValidCIDR);
  let totalSubnets = 0;
  for (let i = 0; i < count; i++) {
    const az = availabilityZones.names[i];

    const privateSubnet = new aws.ec2.Subnet(`privateSubnet${i + 1}`, {
      vpcId: vpc.id,
      cidrBlock: firstInitialSubnets[totalSubnets].value,
      availabilityZone: az,
      tags: userTags(`private-subnet${i + 1}`),
    });
    privateSubnets.push(privateSubnet);
    totalSubnets++;


    const publicSubnet = new aws.ec2.Subnet(`publicSubnet${i + 1}`, {
      vpcId: vpc.id,
      cidrBlock: firstInitialSubnets[totalSubnets].value,
      availabilityZone: az,
      tags: userTags(`public-subnet${i + 1}`),
    });
    publicSubnets.push(publicSubnet);
    totalSubnets++;
  }

  console.log(`----- Created ${privateSubnets.length} private subnets and ${publicSubnets.length} public subnets -----`);


  privateSubnets.forEach((subnet, index) => {
    new aws.ec2.RouteTableAssociation(`privateSubnetAssociation${index + 1}`, {
      subnetId: subnet.id,
      routeTableId: privateRouteTable.id,
    });
  });

  publicSubnets.forEach((subnet, index) => {
    new aws.ec2.RouteTableAssociation(`publicSubnetAssociation${index + 1}`, {
      subnetId: subnet.id,
      routeTableId: publicRouteTable.id,
    });
  });


  // A8 -->Create a Security Group for Load Balancer
  const lbSecurityGroup = new aws.ec2.SecurityGroup("lbSecurityGroup", {
    vpcId: vpc.id,
    description: "Security group for Load Balancer",
    ingress: [
      {
        protocol: "tcp",
        fromPort: 80,
        toPort: 80,
        cidrBlocks: ["0.0.0.0/0"], // Allow HTTP from anywhere
      },
      {
        protocol: "tcp",
        fromPort: 443,
        toPort: 443,
        cidrBlocks: ["0.0.0.0/0"], // Allow HTTPS from anywhere
      },
    ],
    egress: [
      {
        fromPort: 0,
        toPort: 0,
        protocol: -1,
        cidrBlocks: ["0.0.0.0/0"], // Allow all outbound traffic
      },
    ],
    tags: userTags("lb-security-group"),
  });


  // Update the App Security Group
  const appSecurityGroup = new aws.ec2.SecurityGroup("appSecurityGroup", {
    vpcId: vpc.id,
    ingress: [
      {
        protocol: "tcp",
        fromPort: 22,
        toPort: 22,
        cidrBlocks: ["0.0.0.0/0"], // Allow SSH from anywhere
       // securityGroups: [lbSecurityGroup.id], // Allow SSH only from Load Balancer Security Group
      },
      {
        protocol: "tcp",
        fromPort: applicationPort,
        toPort: applicationPort,
        securityGroups: [lbSecurityGroup.id], // Allow application traffic only from Load Balancer Security Group
      },
    ],
    egress: [
      {
        fromPort: 0,
        toPort: 0,
        protocol: -1,
        cidrBlocks: ["0.0.0.0/0"],
      },
    ],

    tags: userTags("app-security-group"),
  });


  const keyPair = new aws.ec2.KeyPair("mySSHKey", {
    publicKey: publicSSHkey,
  });


  // IAM Role and Policy for EC2
  const ecRole = new aws.iam.Role("ec2Role", {
    assumeRolePolicy: {
      Version: "2012-10-17",
      Statement: [{
        Action: "sts:AssumeRole",
        Effect: "Allow",
        Principal: {
          Service: "ec2.amazonaws.com",
        },
      }],
    },
  });

  const policyAttachment = new aws.iam.PolicyAttachment("cloudWatchAgentServerPolicyAttachment", {
    policyArn: "arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy",
    roles: [ecRole.name],
  });

  const ec2InstanceProfile = new aws.iam.InstanceProfile("ec2InstanceProfile", {
    role: ecRole.name,
  });


  // -----------------------End of IAM Role and Policy for EC2

  //Create RDS Subnet Group

  const rdsSubnets = new aws.rds.SubnetGroup("my-rds-subnets", {
    subnetIds: [privateSubnets[0].id, privateSubnets[1].id], // subnetIds: [publicSubnets[0].id, publicSubnets[1].id],
    description: "RDS Subnet Group",
  });


  // Create DB Security Group for RDS instances.
  const dbSecurityGroup = new aws.ec2.SecurityGroup("dbSecurityGroup", {
    vpcId: vpc.id,
    ingress: [
      {
        protocol: "tcp",
        fromPort: 3306,
        toPort: 3306,
        securityGroups: [appSecurityGroup.id], // Allows traffic from appSecurityGroup
      },
    ],
    egress: [
      {
        protocol: "tcp",
        fromPort: 0,
        toPort: 65535,
        cidrBlocks: ["0.0.0.0/0"], // Allow all outbound traffic
      },
    ],
    tags: userTags("dbSecurityGroup"),
  });


  // Create RDS Parameter Group
  const dbParameterGroup = new aws.rds.ParameterGroup("dbparametergroup", {
    family: "mysql8.0", // Updated family value
    description: "Custom db Parameter Group for csye6225",
    parameters: [
      {
        name: "character_set_server",
        value: "utf8", // Set your desired character set
      },
      {
        name: "character_set_client",
        value: "utf8", // Set your desired collation
      },
      {
        name: "max_connections",  // Add the max_connections parameter
        value: "100", // Set your desired maximum connections value
      },
    ],
  });




//-------------------GCP------------------

// Create a Google Cloud Storage bucket
const gcpBucket = new gcp.storage.Bucket("csye6225-002775682", {
  location: "us-east1",
  storageClass: "STANDARD",
  forceDestroy: true,
  //project:  
  
});

// Create a Google Service Account
const serviceAccount = new gcp.serviceaccount.Account("serviceAccount", {
  accountId: "service-account-id",
  displayName: "Service Account"
});

// Create Access Keys for the Google Service Account
const accessKeys = new gcp.serviceaccount.Key("my-access-keys", {
  serviceAccountId: serviceAccount.name,
  publicKeyType : "TYPE_X509_PEM_FILE",
});


// Assign the roles/storage.objectCreator role to the service account for the bucket
const bucketIAMBinding = new gcp.storage.BucketIAMBinding("bucketIAMBinding", {
  bucket: gcpBucket.name,
  members: [serviceAccount.email.apply((e)=>`serviceAccount:${e}`)],
  role: "roles/storage.objectCreator",
});

// snstopic
const snsTopic = new aws.sns.Topic("Submissions");

//Define the IAM Role for Lambda
const lambdaRole = new aws.iam.Role("lambda_role", {
  assumeRolePolicy: JSON.stringify({
      Version: "2012-10-17",
      Statement: [{
          Action: "sts:AssumeRole",
          Principal: {
              Service: "lambda.amazonaws.com",
          },
          Effect: "Allow",
          Sid: "",
      }],
  }),
});

// SES POLICY FOR LAMBDA
// Create an SES policy
const sesPolicy = new aws.iam.Policy("sesPolicy", {
  name: "SES_Policy",
  description: "Policy for SES permissions",
  policy: JSON.stringify({
      Version: "2012-10-17",
      Statement: [{
          Effect: "Allow",
          Action: [
              "ses:SendEmail",
              "ses:SendRawEmail",
              "ses:SendTemplatedEmail",
              "ses:SendBulkTemplatedEmail",
              "ses:SendCustomVerificationEmail",
              "ses:SendEmailVerification",
              "ses:SendRawEmail",
              "ses:SendTemplatedEmail",
              "ses:VerifyEmailIdentity",
              "ses:VerifyEmailAddress",
          ],
          Resource: "*",
      },
  ],
}),
});


const dynampolicy = new aws.iam.Policy("dynampolicy", {
  name: "dynampolicy",
  description: "Policy for Dynamodb permissions",
  policy: JSON.stringify({
      Version: "2012-10-17",
      Statement: [{
          Effect: "Allow",
          Action: [
              "dynamodb:PutItem",
              "dynamodb:GetItem",
              "dynamodb:UpdateItem",
              "dynamodb:BatchWriteItem",
          ],
          Resource: "*",
      },
  ],
}),
});



// // Attach the IAM Policy for DynamoDB access to the IAM Role
// const dynamodbPolicyAttachment = new aws.iam.PolicyAttachment("dynamodb_policy_attachment", {
//   policyArn: "arn:aws:iam::aws:policy/service-role/AWSLambdaDynamoDBExecutionRole",
//   roles: [lambdaRole.name],
// });


// Dyno Table
const emailTrackingTable = new aws.dynamodb.Table("EmailTrackingTable", {
  attributes: [
    { name: "EmailId", type: "S" },
    { name: "Timestamp", type: "S" },
    { name: "Status", type: "S" }, // New attribute
    // Add additional attributes as needed
  ],
  hashKey: "EmailId",
  rangeKey: "Timestamp",
  billingMode: "PAY_PER_REQUEST",
  // billingMode: "PROVISIONED",  // Switch to provisioned billing mode
  // readCapacity: 5,  // Set the desired read capacity units (RCUs)
  // writeCapacity: 5,
  globalSecondaryIndexes: [
      {
        name: "StatusIndex",
        hashKey: "Status",
        projectionType: "ALL",
      },
    ],
  });


// // Attach a policy to the role that grants permission to write logs to CloudWatch
const lambdaRolePolicy = new aws.iam.RolePolicyAttachment("lambdaRolePolicy", {
  role: lambdaRole.name,
  policyArn: lambdaRolePolicyarn,
  
});

const lambdaRolePolicySES = new aws.iam.RolePolicyAttachment("lambdaRolePolicySES", {
  role: lambdaRole.name,
  policyArn: sesPolicy.arn,
  
});
const Dynamodbaccesspolicy = new aws.iam.RolePolicyAttachment("Dynamodbaccesspolicy", {
  role: lambdaRole.name,
  // policyArn: "arn:aws:iam::aws:policy/AmazonDynamoDBFullAccess",
  policyArn: dynampolicy.arn,
 
  
});

// Create the Lambda Function
const lambdaFunction = new aws.lambda.Function("middleware", {
  runtime: "nodejs14.x",
  handler: "index.handler",
  code: new pulumi.asset.AssetArchive({
      ".": new pulumi.asset.FileArchive("C:\\Users\\HOME\\Desktop\\Cloud Assignments\\serverless"),
  }),
  environment: {
      variables: {
          GCS_BUCKET_NAME: "csye6225-002775682-04b4ab1", // Replace with your GCS Bucket Name variable
          MAILGUN_API_KEY: "", // Replace with your Mailgun API Key
          MAILGUN_DOMAIN: "jayeshtak.me", // Replace with your Mailgun Domain
          MAILGUN_SENDER: "tak.jayesh1993@jayeshtak.me", // Replace with your Mailgun Sender Email
          DYNAMODB_TABLE: emailTrackingTable.name,
          AWS_REGIONE: "us-east-1",
          GCP_SECRET_KEY :  accessKeys.privateKey,
          GCP_REGION: "us-east1",
          PROJECT_ID: serviceAccount.project
      },
  },
  role: lambdaRole.arn,
  timeout: 30,
});

// Subscribe the Lambda function to the SNS topic
const snsTopicSubscription = new aws.sns.TopicSubscription("lambdaSubscription", {
  protocol: "lambda",
  endpoint: lambdaFunction.arn,
  topic: snsTopic.arn, // Replace with your SNS Topic ARN
});

// Set the Lambda Permission for invoking the function
const lambdaPermission = new aws.lambda.Permission("function-with-sns", {
  action: "lambda:InvokeFunction",
  function: lambdaFunction.name,
  principal: "sns.amazonaws.com",
  sourceArn: snsTopic.arn,
});

//-------------------GCP------------------

  // Create RDS Instance
  const rdsInstance = new aws.rds.Instance("rdsinstance", {
    engine: "mysql",
    instanceClass: "db.t2.micro",
    dbSubnetGroupName: rdsSubnets.name, // Use Private subnet for RDS instances
    //availabilityZone: availabilityZones.names[0],
    publiclyAccessible: false,
    allocatedStorage: 20, // Size in GB
    multiAz: false,
    dbName: dbName, // Database name
    username: username, // Database username
    password: password,   // Enter your password here
    skipFinalSnapshot: true, // Skipping final snapshot for simplicity, consider setting this to false for production.
    parameterGroupName: dbParameterGroup.name,
    vpcSecurityGroupIds: [dbSecurityGroup.id],
    tags: userTags("csye6225-rds-instance"),
    instanceIdentifier: "csye6225-rds-instance",
  }, {
    dependsOn: [dbSecurityGroup, rdsSubnets, dbParameterGroup]

  });


  snsTopic.arn.apply(arn => console.log(arn));

  // After RDS Instance is created, use its address in the user data script
  const userDataScript = pulumi.all([rdsInstance.address, rdsInstance.username, rdsInstance.password, rdsInstance.dbName,snsTopic.arn]).apply(([address, username, password, dbName, snsTopicArn]) => {
    return `#!/bin/bash
sudo rm -rf /opt/csye6225/webapp/.env
sudo echo "MYSQL_HOST=${address}" | sudo tee -a /opt/csye6225/webapp/.env
sudo echo "MYSQL_USER='${username}'" | sudo tee -a /opt/csye6225/webapp/.env
sudo echo "MYSQL_PASSWORD='${password}'" | sudo tee -a /opt/csye6225/webapp/.env
sudo echo "MYSQL_DATABASE='${dbName}'" | sudo tee -a /opt/csye6225/webapp/.env
sudo echo "MYSQL_DIALECT='${dialect}'" | sudo tee -a /opt/csye6225/webapp/.env
sudo echo "TOPIC_ARN='${snsTopicArn}'" | sudo tee -a /opt/csye6225/webapp/.env
sudo echo "REGION='${regione}'" | sudo tee -a /opt/csye6225/webapp/.env
sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
    -a fetch-config \
    -m ec2 \
    -c file:/opt/aws/amazon-cloudwatch-agent/etc/cloudwatch-config.json \
    -s
sudo systemctl daemon-reload
sudo systemctl enable webapp
sudo systemctl start webapp
sudo systemctl enable amazon-cloudwatch-agent
sudo systemctl start amazon-cloudwatch-agent
`;
  });


  const userDataBase64 = userDataScript.apply(us => Buffer.from(us).toString("base64"));

  // Create a Target Group for the Load Balancer
  const appTargetGroup = new aws.lb.TargetGroup("appTargetGroup", {
    port: applicationPort,
    protocol: "HTTP",
    targetType: "instance",
    vpcId: vpc.id,
    healthCheck: {
      enabled: true,
      matcher: "200",
      path: "/healthz", // Modify as per your application's health check endpoint
      protocol: "HTTP",
      interval: 30,
    },
    tags: userTags("app-target-group"),
  });


  // Create Application Load Balancer
  const appLoadBalancer = new aws.lb.LoadBalancer("appLoadBalancer", {
    internal: false,
    loadBalancerType: "application",
    securityGroups: [lbSecurityGroup.id],
    subnets: publicSubnets.map(subnet => subnet.id),
    enableDeletionProtection: false,
    tags: userTags("app-load-balancer"),
  });

  // Create Load Balancer Listener
  const appListener = new aws.lb.Listener("appListener", {
    loadBalancerArn: appLoadBalancer.arn,
    port: 80,
    protocol: "HTTP",
    defaultActions: [{
      type: "forward",
      targetGroupArn: appTargetGroup.arn,
    }],
    tags: userTags("app-listener"),
  });

  // Create Launch Template for Auto Scaling
  const appLaunchTemplate = new aws.ec2.LaunchTemplate("appLaunchTemplate", {
    imageId: customAmiId, // Your custom AMI ID
    instanceType: "t2.micro",
    keyName: keyPair, // Replace with your key name "YOUR_AWS_KEYNAME"
    networkInterfaces: [{
      associatePublicIpAddress: true,
      securityGroups: [appSecurityGroup.id],
    }],
    userData: userDataBase64, // Use the same user data as your current EC2 instance
    iamInstanceProfile: {
      arn: ec2InstanceProfile.arn,
    },
    // ... [Any other configurations if necessary]
    tags: userTags("app-launch-template"),
  });

  // Create Auto Scaling Group
  const appAutoScalingGroup = new aws.autoscaling.Group("appAutoScalingGroup", {
    desiredCapacity: 1,
    minSize: 1,
    maxSize: 3,
    cooldown: 60,
    targetGroupArns: [appTargetGroup.arn],
    launchTemplate: {
      id: appLaunchTemplate.id,
      version: `$Latest`,
    },
    vpcZoneIdentifiers: publicSubnets.map(subnet => subnet.id), // Replace with subnet IDs
    tags: [{
      key: "Name",
      value: "auto-scaling-instance",
      propagateAtLaunch: true,
    }],
    // ... [Any other configurations if necessary]
  });


  // Create Scale Up Policy
  const scaleUpPolicy = new aws.autoscaling.Policy("scaleUpPolicy", {
    scalingAdjustment: 1,
    adjustmentType: "ChangeInCapacity",
    cooldown: 60,
    autoscalingGroupName: appAutoScalingGroup.name,
    policyType: "SimpleScaling",
    //estimatedInstanceWarmup: 300,
  });

  // Create Scale Down Policy
  const scaleDownPolicy = new aws.autoscaling.Policy("scaleDownPolicy", {
    scalingAdjustment: -1,
    adjustmentType: "ChangeInCapacity",
    cooldown: 60,
    autoscalingGroupName: appAutoScalingGroup.name,
    //policyType: "SimpleScaling",
  });


  // CloudWatch Alarm for Scale Up
  const scaleUpAlarm = new aws.cloudwatch.MetricAlarm("scaleUpAlarm", {
    metricName: "CPUUtilization",
    namespace: "AWS/EC2",
    statistic: "Average",
    period: 60,
    evaluationPeriods: 1,
    threshold: 5,
    comparisonOperator: "GreaterThanThreshold",
    alarmActions: [scaleUpPolicy.arn],
    dimensions: {
      AutoScalingGroupName: appAutoScalingGroup.name,
    },
  });

  // CloudWatch Alarm for Scale Down
  const scaleDownAlarm = new aws.cloudwatch.MetricAlarm("scaleDownAlarm", {
    metricName: "CPUUtilization",
    namespace: "AWS/EC2",
    statistic: "Average",
    period: 60,
    evaluationPeriods: 1,
    threshold: 3,
    comparisonOperator: "LessThanThreshold",
    alarmActions: [scaleDownPolicy.arn],
    dimensions: {
      AutoScalingGroupName: appAutoScalingGroup.name,
    },
  });

  // Add or Update A record to point to the EC2 instance
  const domainName = "demo.jayeshtak.me"; // replace with your domain name
  const hostedZoneId = "Z05430071KGEB0K2VUTET"; // replace with your hosted zone ID

 // After Load Balancer is created, define Route 53 A record
const aRecord = appLoadBalancer.dnsName.apply(dnsName => {
  return new aws.route53.Record("demo.jayeshtak.me-A", {
    zoneId: hostedZoneId,
    name: domainName,
    type: "A",
    aliases: [{
      name: dnsName,
      zoneId: appLoadBalancer.zoneId, // Load Balancer Zone ID
      evaluateTargetHealth: true,
    }],
  });
});

}

createServices();


