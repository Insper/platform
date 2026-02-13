The internet is a global network of interconnected computers and servers that communicate with each other using standardized protocols. It allows users to access and share information, communicate with others, and perform various online activities. This global networks was developed in the late 1960s with the goal of creating a resilient and decentralized communication system. Over the years, the internet has evolved and standards have been established to ensure interoperability and security.

In the initial os 80s, the TCP/IP, [RFC 791](https://datatracker.ietf.org/doc/html/rfc791){target="_blank"}[^5], protocol suite was developed, which became the foundation of the internet. This protocol suite allows for the transmission of data packets across the network and enables communication between different devices and networks. The basic premise of the internet is that each device connected to the network is assigned a unique IP address, which allows it to send and receive data. When a user wants to access a website or send an email, their device sends a request to the appropriate server using the IP address. The server then processes the request and sends the requested data back to the user's device.

## Public Networks (Internet)

To reach a server on the internet, its computer (the computer where the server is hosted) needs to know its IP address, a **Public IP** address. When the TCP/IP protocol suite was developed, the number of available IP addresses was limited, and it became clear that a more efficient way to manage IP addresses was needed. The IPv4 protocol, which uses 32-bit addresses, was initially used, but it has a limited number of available addresses (approximately 4.3 billion).

As the internet grew, it became clear that this was not sufficient to accommodate the increasing number of devices and servers. This led to the development of the IPv6 protocol, which uses 128-bit addresses and provides a much larger address space (approximately 3.4 x 10^38 addresses). However, the transition from IPv4 to IPv6 has been slow, and many devices and servers still use IPv4 addresses - [IPv6 Adoption](https://www.google.com/intl/en/ipv6/){target="_blank"}.

Thefore, to allow devices with private IP addresses (which are not routable on the internet) to communicate with servers on the internet, a technique called Network Address Translation (NAT) is used. NAT allows multiple devices on a local network to share a single public IP address when accessing the internet. This is done by translating the [**Private IP**](https://en.wikipedia.org/wiki/Private_network){target="_blank"}[^3] addresses of the devices to the public IP address of the NAT device (such as a router) when sending requests to the internet, and translating the responses back to the appropriate private IP addresses when receiving data from the internet.

## Private Networks

Private networks are networks that are not directly accessible from the public internet. They are used to isolate resources and provide a secure environment for communication between devices. In the context of Docker, private networks allow containers to communicate with each other without exposing their services to the outside world.

<center>
``` mermaid
---
title: Network Address Translation (NAT)
---
flowchart TB
    host1@{ shape: docs, label: "Host 1"} ---|Public IP| internet([Internet])
    host2@{ shape: docs, label: "Host 2"} ---|Public IP| internet([Internet])
    host3@{ shape: docs, label: "Host 3"} ---|Public IP| internet([Internet])
    internet((Internet)) ---|Public IP| router1((Border Router<br>NAT<br>10.0.0.0/8))
    router1 ---|Private IP| device1([Device 1])
    router1 ---|Private IP| device2([Device 2])
    router1 ---|Private IP| device3([Device 3])
    router1 ---|Private IP| router2((Router<br>NAT<br>172.16.0.0/12))
    router2 ---|Private IP| router3((Router<br>NAT<br>192.168.0.0/16))
    router2 ---|Private IP| router4((Router<br>NAT<br>192.168.0.0/16))
    router2 ---|Private IP| device4([Device 4])
    router2 ---|Private IP| device5([Device 5])
    router3 ---|Private IP| device6([Device 6])
    router3 ---|Private IP| device7([Device 7])
    router4 ---|Private IP| device8([Device 8])
    router4 ---|Private IP| device9([Device 9])
    classDef internet fill:#ccf
    classDef router fill:#fcc
    classDef device fill:#cfc
    class internet internet
    class router1,router2,router3,router4 router
    class device1,device2,device3,device4,device5,device6,device7,device8,device9 device
```
<i>The diagram illustrates a network setup with multiple routers and devices, where each router uses Network Address Translation (NAT) to manage private IP addresses. The internet is connected to the first router (the border router), which has a public IP address, while the other routers and devices use private IP addresses within their respective subnets.</i>
</center>

Private networks are defined by specific IP address ranges that are reserved for private use. These ranges are not routable on the public internet, ensuring that devices within a private network can communicate securely without interference from external networks.

## Reserved IPv4 Addresses [^4]

### General Reserved IPv4 Addresses

| Address block (CIDR)| Address range | Number of addresses | Scope | Description
|----------------------|----------------|--------------------:|-------|-------------
| 0.0.0.0/8            | 0.0.0.0<br>0.255.255.255 | 16.777.216 | Software | Current (local, "this") network |
| 10.0.0.0/8           | 10.0.0.0<br>10.255.255.255 | 16.777.216 | Private network | Used for local communications within a private network |
| 100.64.0.0/10       | 100.64.0.0<br>100.127.255.255 | 4.194.304 | Private network | Shared address space for communications between a service provider and its subscribers when using a carrier-grade NAT |
| 127.0.0.0/8         | 127.0.0.0<br>127.255.255.255 | 16.777.216 | Host | Used for loopback addresses to the local host |
| 169.254.0.0/16      | 169.254.0.0<br>169.254.255.255 | 65.536 | Subnet | Used for link-local addresses between two hosts on a single link when no IP address is otherwise specified, such as would have normally been retrieved from a DHCP server |
| 172.16.0.0/12      | 172.16.0.0<br>172.31.255.255 | 1.048.576 | Private network | Used for local communications within a private network |
| 192.0.0.0/24       | 192.0.0.0<br>192.0.0.255 | 256 | Private network | IETF Protocol Assignments, DS-Lite (/29) |
| 192.0.2.0/24       | 192.0.2.0<br>192.0.2.255 | 256 | Documentation | Assigned as TEST-NET-1, documentation and examples |
| 192.88.99.0/24     | 192.88.99.0<br>192.88.99.255 | 256 | Internet | Reserved. Formerly used for IPv6 to IPv4 relay (included IPv6 address block 2002::/16). |
| 192.168.0.0/16     | 192.168.0.0<br>192.168.255.255 | 65.536 | Private network | Used for local communications within a private network |
| 198.18.0.0/15      | 198.18.0.0<br>198.19.255.255 | 131.072 | Private network | Used for benchmark testing of inter-network communications between two separate subnets |
| 198.51.100.0/24    | 198.51.100.0<br>198.51.100.255 | 256 | Documentation | Assigned as TEST-NET-2, documentation and examples |
| 203.0.113.0/24     | 203.0.113.0<br>203.0.113.255 | 256 | Documentation | Assigned as TEST-NET-3, documentation and examples |
| 224.0.0.0/4        | 224.0.0.0<br>239.255.255.255 | 268.435.456 | Internet | In use for multicast (former Class D network) |
| 233.252.0.0/24     | 233.252.0.0<br>233.252.0.255 | 256 | Documentation | Assigned as MCAST-TEST-NET, documentation and examples (This is part of the above multicast space.) |
| 240.0.0.0/4       | 240.0.0.0<br>255.255.255.254 | 268.435.455 | Internet | Reserved for future use (former Class E network) |
| 255.255.255.255/32 | 255.255.255.255           | 1   | Subnet      | Reserved for the "limited broadcast" destination address |


### Private IPv4 Addresses [^2]

| Address block (CIDR) | Address range | Number of addresses | Scope | Description |
|----------------------|----------------|--------------------:|-------|-------------
| 10.0.0.0/8           | 10.0.0.0<br>10.255.255.255 | 16.777.216 | Private network | Used for local communications within a private network |
| 172.16.0.0/12      | 172.16.0.0<br>172.31.255.255 | 1.048.576 | Private network | Used for local communications within a private network |
| 192.168.0.0/16     | 192.168.0.0<br>192.168.255.255 | 65.536 | Private network | Used for local communications within a private network |


[^1]: [List of reserved IP addresses](https://en.wikipedia.org/wiki/List_of_reserved_IP_addresses){target="_blank"}

[^2]: [RFC 1918 - Address Allocation for Private Internets](https://datatracker.ietf.org/doc/html/rfc1918){:target="_blank"}

[^3]: [Private Network](https://en.wikipedia.org/wiki/Private_network){:target="_blank"}

[^4]: [Reserved IP Addresses](https://en.wikipedia.org/wiki/Reserved_IP_addresses){:target="_blank"}

[^5]: [RFC 791 - Internet Protocol](https://datatracker.ietf.org/doc/html/rfc791){:target="_blank"}

[^6]: [IPv6 Adoption](https://www.google.com/intl/en/ipv6/){target="_blank"}: A resource that tracks the adoption of IPv6 across the internet, providing statistics and insights into the transition from IPv4 to IPv6.