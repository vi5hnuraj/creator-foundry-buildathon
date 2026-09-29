// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/token/common/ERC2981.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title CreatorFoundryAssetNFT
 * @notice Proof-of-authorship NFTs for individual creative contributions.
 *
 * Each approved bounty is minted here as an ERC-721 with metadata pointing at
 * the delivered asset. The contributor is recorded as the ERC-2981 royalty
 * receiver at mint time, so attribution and resale royalties are enforced
 * on-chain — not tracked in a spreadsheet.
 *
 * Works on any EVM chain, including Arbitrum One, Arbitrum Sepolia and
 * Robinhood Chain (an Arbitrum Orbit chain).
 */
contract CreatorFoundryAssetNFT is ERC721URIStorage, ERC2981, Ownable {
    /// @dev Hard cap on per-token resale royalties (15%).
    uint96 public constant MAX_ROYALTY_BPS = 1_500;

    uint256 public nextTokenId;

    error InvalidRoyaltyReceiver();
    error RoyaltyTooHigh(uint96 requested, uint96 max);

    event AssetMinted(uint256 indexed tokenId, address indexed to, address indexed royaltyReceiver, uint96 royaltyBps);

    constructor() ERC721("Creator Foundry Asset", "CFA") Ownable(msg.sender) {}

    /**
     * @notice Mint a contribution asset to `to` with `royaltyReceiver` earning
     * `royaltyBps` (in basis points, e.g. 1_000 = 10%) on every resale.
     */
    function mint(
        address to,
        string calldata uri,
        address royaltyReceiver,
        uint96 royaltyBps
    ) external returns (uint256 tokenId) {
        if (royaltyReceiver == address(0)) revert InvalidRoyaltyReceiver();
        if (royaltyBps > MAX_ROYALTY_BPS) revert RoyaltyTooHigh(royaltyBps, MAX_ROYALTY_BPS);

        tokenId = nextTokenId;
        nextTokenId = tokenId + 1;

        _mint(to, tokenId);
        _setTokenURI(tokenId, uri);
        _setTokenRoyalty(tokenId, royaltyReceiver, royaltyBps);

        emit AssetMinted(tokenId, to, royaltyReceiver, royaltyBps);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721URIStorage, ERC2981)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
