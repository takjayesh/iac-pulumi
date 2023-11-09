const pulumi = require("@pulumi/pulumi");
const aws = require("@pulumi/aws");
const SubnetCIDRAdviser = require("subnet-cidr-calculator");

const config = new pulumi.Config();
const cidrBlock = config.require("cidrBlock");
const vpcName = config.require("vpcName");
const publicSSHkey = config.require("publicSSHkey"); // Public SSH key to be added to the EC2 instance
const publicSubnetCidr = config.require("publicSubnetCidr");
const existingSubnetCIDR = config.require("existingSubnetCIDR");
const addressDotQuad = config.require("addressDotQuad");
const netmaskBits = config.require("netmaskBits");
const customAmiId = "ami-0dbe0090956ef0d0f";
const applicationPort = config.require("applicationPort");
const dbName = config.require("dbName");
const username = config.require("username");
const password = config.require("password");


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

  // Create an Application Security Group
  const appSecurityGroup = new aws.ec2.SecurityGroup("appSecurityGroup", {
    vpcId: vpc.id,
    ingress: [
      {
        protocol: "tcp",
        fromPort: 22,
        toPort: 22,
        cidrBlocks: ["0.0.0.0/0"], // Allow SSH from anywhere
      },
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
      {
        protocol: "tcp",
        fromPort: applicationPort,
        toPort: applicationPort,
        cidrBlocks: ["0.0.0.0/0"], // Allow your application traffic from anywhere
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




  // Create an EC2 instance
  const appInstance = new aws.ec2.Instance("appInstance", {
    instanceType: "t2.micro",
    ami: customAmiId,
    vpcSecurityGroupIds: [appSecurityGroup.id],
    subnetId: publicSubnets[0].id, // Use the first public subnet
    availabilityZone: availabilityZones.names[0],
    iamInstanceProfile: ec2InstanceProfile.id,
    //associatePublicIpAddress: true,  // Check this
    rootBlockDevice: {
      volumeSize: 25,
      volumeType: "gp2",
      deleteOnTermination: true,
    },
    keyName: keyPair.keyName,
    tags: userTags("myEc2Instance"),
    userData: pulumi.interpolate`#!/bin/bash
    sudo rm -rf /opt/csye6225/webapp/.env
    sudo echo "MYSQL_HOST=${rdsInstance.address}" | sudo tee -a /opt/csye6225/webapp/.env
    sudo echo "MYSQL_USER='${rdsInstance.username}'" | sudo tee -a /opt/csye6225/webapp/.env
    sudo echo "MYSQL_PASSWORD='${rdsInstance.password}'" | sudo tee -a /opt/csye6225/webapp/.env
    sudo echo "MYSQL_DATABASE='${rdsInstance.dbName}'" | sudo tee -a /opt/csye6225/webapp/.env
    sudo echo "MYSQL_DIALECT='${dialect}'" | sudo tee -a /opt/csye6225/webapp/.env  
    sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
        -a fetch-config \
        -m ec2 \
        -c file:/opt/aws/amazon-cloudwatch-agent/etc/cloudwatch-config.json \
        -s
        sudo systemctl daemon-reload
        sudo systemctl enable webapp
        sudo systemctl start webapp
        sudo systemctl enable amazon-cloudwatch-agent
        sudo systemctl start amazon-cloudwatch-agent`,
  }, {
    dependsOn: [
      vpc,
      ...privateSubnets,  // Assuming privateSubnet is an array
      ...publicSubnets    // Assuming publicSubnet is an array
    ],
  });



  const eip = new aws.ec2.Eip("myEip", {
    instance: appInstance.id,
    //vpc: true, // make sure the EIP is in the VPC
  });


  const eipAssociation = new aws.ec2.EipAssociation("myEipAssociation", {
    instanceId: appInstance.id,
    publicIp: eip.publicIp,
    // allocationId: eip.allocationId,
  }, { dependsOn: [appInstance] }); // Making sure the association happens after the instance is created


  // Add or Update A record to point to the EC2 instance
  const domainName = "demo.jayeshtak.me"; // replace with your domain name
  const hostedZoneId = "Z05430071KGEB0K2VUTET"; // replace with your hosted zone ID

  const aRecord = new aws.route53.Record(`${domainName}-A`, {
    zoneId: hostedZoneId,
    name: domainName,
    type: "A",
    ttl: 300,
    records: [eip.publicIp],
  }, { dependsOn: [eipAssociation] }); // Ensure the record is created after the EIP is associated

}

createServices();
