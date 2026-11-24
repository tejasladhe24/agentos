# 116 — (Later) Files: more storage adapters

**Status:** todo

## Goal

Add the remaining popular storage providers once the mount interface (ticket **110**) has proven itself on buckets, flat stores, and drives. Split into one ticket per provider when picked up.

## Depends on

- Ticket **110**; drive-style providers also **113**

## Candidates

| Provider                          | Kind           | Mount           | Notes                                                    |
| --------------------------------- | -------------- | --------------- | -------------------------------------------------------- |
| Dropbox                           | Drive (OAuth)  | Personal        | Path API; team space differs for business accounts       |
| Box                               | Drive (OAuth)  | Personal        | Enterprise demand                                        |
| Azure Blob Storage                | Object store   | Org             | Own adapter (not S3-compatible); SAS or account key      |
| Cloudinary                        | Media          | Org             | Media-focused; transformations; awkward as general drive |
| Uploadcare                        | Upload service | Org             | Flat, like UploadThing                                   |
| Bunny Storage                     | Object/CDN     | Org             | Own API                                                  |
| WebDAV (Nextcloud, ownCloud, NAS) | Protocol       | Org or personal | Basic auth or app password                               |
| SFTP                              | Protocol       | Org             | Key or password auth                                     |

## Done when

- [ ] Each picked provider ships as its own ticket with adapter, capabilities, tests, docs
