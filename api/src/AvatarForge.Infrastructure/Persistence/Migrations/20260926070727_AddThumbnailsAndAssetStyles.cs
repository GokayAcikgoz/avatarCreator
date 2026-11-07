using System.Collections.Generic;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AvatarForge.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddThumbnailsAndAssetStyles : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ThumbnailUrl",
                table: "Avatars",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "AlwaysOn",
                table: "Assets",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<List<string>>(
                name: "Styles",
                table: "Assets",
                type: "text[]",
                nullable: false,
                // Existing rows get an empty array; AssetSeeder fills real values on the next boot.
                defaultValueSql: "'{}'");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ThumbnailUrl",
                table: "Avatars");

            migrationBuilder.DropColumn(
                name: "AlwaysOn",
                table: "Assets");

            migrationBuilder.DropColumn(
                name: "Styles",
                table: "Assets");
        }
    }
}
