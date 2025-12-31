Feature: User login on social networking site
  The user should be able to login into the social networking site with valid credentials.
  The user should be shown an error message with invalid credentials.

  Scenario Outline: Login functionality for a social networking site
    Given the user navigates to the login page
    When I enter Username as "<username>" and Password as "<password>"
    And I click the login button
    Then the login should be "<outcome>"

    Examples: Valid Credentials
    | username | password | outcome |
    | user1 | pass1 | successful |
    | user2 | pass2 | successful |

    Examples: Invalid Credentials
    | username | password | outcome |
    | invalidU | invalidP | unsuccessful |
    | user3 | wrongP | unsuccessful |
