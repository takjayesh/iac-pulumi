"use strict";

const pulumi = require("@pulumi/pulumi");
const aws = require("@pulumi/aws");
const awsx = require("@pulumi/awsx");
// Create a new VPC
const vpc = new aws.ec2.Vpc("myVpc", {
    cidrBlock: "10.0.0.0/16",
    enableDnsSupport: true,
    enableDnsHostnames: true,
    tags: {
        Name: "myVpc",
    },
});

// Create and attach an Internet Gateway to the VPC
const internetGateway = new aws.ec2.InternetGateway("myInternetGateway", {
    vpcId: vpc.id,
    tags: {
        Name: "myInternetGateway",
    },
});

// Defining the availability zones used
const availabilityZones = [
    "us-east-1a",
    "us-east-1b",
    "us-east-1c",
];

const publicSubnets = [];
const privateSubnets = [];

// Creating 3 public and 3 private subnets in different availability zones
for (let i = 0; i < 3; i++) {
    const publicSubnet = new aws.ec2.Subnet(`publicSubnet-${i + 1}`, {
        vpcId: vpc.id,
        availabilityZone: availabilityZones[i],
        cidrBlock: `10.0.${i + 1}.0/24`,
        tags: {
            Name: `publicSubnet-${i + 1}`,
        },
    });
    publicSubnets.push(publicSubnet);

    const privateSubnet = new aws.ec2.Subnet(`privateSubnet-${i + 1}`, {
        vpcId: vpc.id,
        availabilityZone: availabilityZones[i],
        cidrBlock: `10.0.${i + 4}.0/24`,
        tags: {
            Name: `privateSubnet-${i + 1}`,
        },
    });
    privateSubnets.push(privateSubnet);
}

// Creating route tables
const publicRouteTable = new aws.ec2.RouteTable("publicRouteTable", {
    vpcId: vpc.id,
    tags: {
        Name: "PublicRouteTable",
    },
});

const privateRouteTable = new aws.ec2.RouteTable("privateRouteTable", {
    vpcId: vpc.id,
    tags: {
        Name: "PrivateRouteTable",
    },
});

// Creating a public route in the public route table
const publicRoute = new aws.ec2.Route("publicRoute", {
    routeTableId: publicRouteTable.id,
    destinationCidrBlock: "0.0.0.0/0",
    gatewayId: internetGateway.id,
});

// Associating public subnets with the public route table
publicSubnets.forEach((publicSubnet, index) => {
    new aws.ec2.RouteTableAssociation(`public-subnet-connect-${index + 1}`, {
        subnetId: publicSubnet.id,
        routeTableId: publicRouteTable.id,
    });
});

// Associating private subnets with the private route table
privateSubnets.forEach((privateSubnet, index) => {
    new aws.ec2.RouteTableAssociation(`private-subnet-connect-${index + 1}`, {
        subnetId: privateSubnet.id,
        routeTableId: privateRouteTable.id,
    });
});

// Export the VPC's ID and the Internet Gateway's ID
exports.vpcId = vpc.id;
exports.internetGatewayId = internetGateway.id;
