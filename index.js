const pulumi = require("@pulumi/pulumi");
const aws = require("@pulumi/aws");
const SubnetCIDRAdviser = require("subnet-cidr-calculator");

const config = new pulumi.Config();
const cidrBlock = config.require("cidrBlock");
const vpcName = config.require("vpcName");
const publicSubnetCidr = config.require("publicSubnetCidr");
const existingSubnetCIDR = config.require("existingSubnetCIDR");
const addressDotQuad = config.require("addressDotQuad");
const netmaskBits = config.require("netmaskBits");
const customAmiId = "ami-06db4d78cb1d3bbf9"; 
const applicationPort = config.require("applicationPort");

const privateSubnets = [];
const publicSubnets = [];

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
    
  });
  
  const keyPair = new aws.ec2.KeyPair("mySSHKey", {
    publicKey:
      "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQDEXDfXrtf7YxbIilz98el0/hMCU5U9S0md9C6GbI+HWGV9YpTwDMkZL01rfO4/kX8Ry1cRVwz8mp1UyvujuVH5BejR9Yrr0mNdUDyVWoyfXmp1YXTgCiXZllOrdm3UYQRNBg3MjEKp3tJvSdV9i4FQhgXj6+6weSRGMso6WT24WfJhrZsPCDFk/hStudCUOC2CLnUB4pk3dEXSFpj+ZzOf6bgfwZDPfcYdlY4c/+XcsALGR87zDC5XdhIftVRhzxDD9wdD2bnNzQS9gtJ9RwrHY6OfglgyBl1/W0jj3K03dS9L6MkSpV9vNluqoCwpMFoqOavowbFIhGyOQFNH8akpHJp+XJQlmwFhTAHOTga4MV50G7ByuZcAuc5G6k82YpaE7eYe4frkDySfG0CgncqY1molwfkAuNAij/wxljZIGHjJDQUVcAsaht0+p3FedStU/xl2jy+QixEPQlRMePQxay5/3UmEJSwVt9Sm0CM7JCNNi+5agxy3XlJI2yUeWyM= jayesh tak@DESKTOP-RFAJMP9",
  });

  // Create an EC2 instance
  const appInstance = new aws.ec2.Instance("appInstance", {
    instanceType: "t2.micro",
    ami: customAmiId,
    vpcSecurityGroupIds: [appSecurityGroup.id],
    subnetId: publicSubnets[0].id, // Use the first public subnet
    rootBlockDevice: {
      volumeSize: 8,
      volumeType: "gp2",
      deleteOnTermination: true,
    },
     keyName: keyPair.keyName,
     tags: userTags("myEc2Instance"),
  });

  const eip = new aws.ec2.Eip("myEip", {
    instance: appInstance.id,
  });
  

  const eipAssocation = new aws.ec2.EipAssociation("myEipAssociation", {
    instanceId: appInstance.id,
    publicIp: eip.publicIp,
  });
}

createServices();
