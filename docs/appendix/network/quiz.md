
Click **"Answer"** to reveal the correct answer and explanation.

---

**Q1.** What is the purpose of a **Public IP address**?

- A. It identifies a device within a private network only
- B. It is a unique address that identifies a device on the public internet, allowing other servers to route traffic directly to it
- C. It is used exclusively by routers to perform NAT
- D. It is reserved for loopback communication on a single host

??? success "Answer"
    **B — Unique address identifying a device on the public internet.**

    Every server reachable on the internet must have a public IP address so that packets from anywhere in the world can be routed to it. Private IP addresses (e.g., `192.168.x.x`) are not routable on the public internet — only the border router's public IP is visible externally.

---

**Q2.** Why was **IPv6** developed to replace IPv4?

- A. IPv4 was vulnerable to encryption attacks that IPv6 resolves
- B. IPv4's 32-bit address space (~4.3 billion addresses) was exhausted as the number of internet-connected devices grew; IPv6 uses 128-bit addresses providing ~3.4 × 10³⁸ addresses
- C. IPv4 could only route packets within private networks
- D. IPv6 is faster because it uses smaller packet headers

??? success "Answer"
    **B — IPv4 address space exhaustion.**

    The internet grew far beyond what was anticipated in the 1970s. With 32-bit addresses, IPv4 supports ~4.3 billion unique addresses — less than the number of devices that now connect to the internet. IPv6's 128-bit space provides a practically unlimited number of addresses, enough for every grain of sand on Earth to have its own address.

---

**Q3.** What does **NAT (Network Address Translation)** allow?

- A. It translates domain names to IP addresses, like DNS
- B. It encrypts traffic between a private network and the internet
- C. It allows multiple devices with private IP addresses to share a single public IP address when communicating with the internet
- D. It assigns permanent public IP addresses to each device on a network

??? success "Answer"
    **C — Multiple private devices share one public IP.**

    When a device with private IP `192.168.1.10` sends a packet to the internet, the NAT router replaces the source address with its own public IP and records the mapping. When the response arrives, NAT translates the destination back to `192.168.1.10` and forwards it to the correct device. This is how an entire home network browses the internet through a single router IP.

---

**Q4.** Which of the following are **private IPv4 address ranges** reserved by RFC 1918? Select all that apply.

- A. `10.0.0.0/8`
- B. `172.16.0.0/12`
- C. `192.168.0.0/16`
- D. `8.8.8.0/24`

??? success "Answer"
    **A, B, and C — `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`.**

    These three ranges are defined by RFC 1918 as private — they are not routable on the public internet and can be freely reused inside any private network. `8.8.8.8` is Google's public DNS server — a public IP address, not private.

---

**Q5.** The address `127.0.0.1` belongs to the `127.0.0.0/8` block. What is its purpose?

- A. It is the default gateway address for most home routers
- B. It is the broadcast address used to send packets to all devices on a subnet
- C. It is the loopback address — packets sent to this range stay on the local host and never reach the network
- D. It is a multicast address used for streaming

??? success "Answer"
    **C — Loopback address; packets stay on the local host.**

    `127.0.0.1` (commonly called `localhost`) routes packets back to the same machine without any network hardware being involved. This is used for testing local servers (e.g., `http://localhost:8080`), inter-process communication, and health checks. The entire `127.0.0.0/8` block is reserved for this purpose.

---

**Q6.** In the context of **Docker**, why are containers placed in private networks?

- A. Docker requires private networks for performance — public IPs add too much overhead
- B. Containers on a private network can communicate with each other by service name without exposing their ports to the host or the internet
- C. Docker containers do not support public IP addresses at all
- D. Private networks allow containers to bypass the host OS firewall

??? success "Answer"
    **B — Containers communicate internally without internet exposure.**

    Docker creates a virtual private network for each Compose project. Containers within that network reach each other by service name (e.g., `db`, `gateway`) using Docker's internal DNS. Only services with a `ports:` mapping in `compose.yaml` are reachable from outside the Docker network — all others are private by default.

---

**Q7.** What is **CIDR notation** (e.g., `192.168.0.0/16`), and what does the `/16` mean?

- A. It specifies a port range; `/16` means ports 1–16 are open
- B. It is a compact way to express an IP address range; `/16` means the first 16 bits are the network prefix, leaving 16 bits for host addresses (65,536 addresses)
- C. It defines the maximum packet size for that network
- D. It indicates the NAT translation depth for nested networks

??? success "Answer"
    **B — Network prefix length; `/16` = 16-bit prefix, 65,536 host addresses.**

    CIDR (Classless Inter-Domain Routing) replaces the old Class A/B/C system. The number after `/` is the prefix length — how many leading bits identify the network. `192.168.0.0/16` has 16 bits fixed (identifying the `192.168.x.x` network) and 16 bits free for hosts: 2¹⁶ = 65,536 possible addresses.

---

**Q8.** A device has the IP address `169.254.10.5`. What does this tell you about its network configuration?

- A. It is a multicast receiver address
- B. It is a documentation address used only in examples and RFCs
- C. The device failed to obtain an IP address from a DHCP server and self-assigned a link-local address from the `169.254.0.0/16` range
- D. It is a carrier-grade NAT address shared between ISP subscribers

??? success "Answer"
    **C — DHCP failure; self-assigned link-local address.**

    When a device cannot reach a DHCP server, it uses **APIPA (Automatic Private IP Addressing)** to pick a random address from `169.254.0.0/16`. These addresses only work for communication within the same local link — they cannot reach routers, the internet, or other subnets. Seeing `169.254.x.x` usually means the device has no network connectivity.

---

**Q9.** What is the difference between the `10.0.0.0/8` and `192.168.0.0/16` private ranges in practical terms?

- A. `10.0.0.0/8` is used only in enterprise networks; `192.168.0.0/16` is only for home networks
- B. `10.0.0.0/8` provides ~16.7 million addresses (suitable for large corporate or cloud networks); `192.168.0.0/16` provides 65,536 addresses (typical for home/small office)
- C. They are identical in size — the CIDR notation is just a naming convention
- D. `10.0.0.0/8` is IPv6; `192.168.0.0/16` is IPv4

??? success "Answer"
    **B — Different sizes for different scales.**

    `10.0.0.0/8` covers all addresses from `10.0.0.0` to `10.255.255.255` — over 16 million addresses. Cloud providers (AWS VPCs, GCP VPCs) typically use this range for their internal networks. `192.168.0.0/16` covers `192.168.0.0` to `192.168.255.255` — 65,536 addresses, typical for home routers (`192.168.0.x` or `192.168.1.x`).

---

**Q10.** When a Docker container with private IP `172.18.0.3` sends a request to a public server on the internet, what happens at the Docker host's NAT layer?

- A. The packet is dropped — containers with private IPs cannot reach the internet
- B. Docker assigns the container a temporary public IP for the duration of the request
- C. The Docker host's NAT replaces the container's private source IP with the host's public IP, forwards the packet, and translates the response back to `172.18.0.3` when it arrives
- D. The public server sees `172.18.0.3` as the source and responds directly to the container

??? success "Answer"
    **C — Host NAT translates private IP → public IP on egress, reverses on ingress.**

    Docker uses Linux's `iptables` NAT rules on the host. When the container at `172.18.0.3` sends a packet outbound, `iptables` replaces the source IP with the host's public IP and records the mapping. When the response arrives at the host's public IP, `iptables` reverses the translation and delivers the packet to `172.18.0.3` inside the container. The public server never sees the private address.
